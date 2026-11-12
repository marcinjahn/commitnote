use gtk4::glib::translate::{ToGlibPtr, ToGlibPtrMut};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, graphene, prelude::*};

use super::MarkdownView;

/// GTK's virtual cursor after a page move, in buffer coordinates, valid while the caret stays at
/// `offset`, where that move left it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PageAim {
    offset: i32,
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PageScroll {
    value: f64,
    lower: f64,
    upper: f64,
    page_size: f64,
    page_increment: f64,
}

impl From<&gtk::Adjustment> for PageScroll {
    fn from(adjustment: &gtk::Adjustment) -> Self {
        Self {
            value: adjustment.value(),
            lower: adjustment.lower(),
            upper: adjustment.upper(),
            page_size: adjustment.page_size(),
            page_increment: adjustment.page_increment(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PageLanding {
    Start,
    End,
    /// A height in buffer coordinates, which the layout clamps to the text.
    At(i32),
}

/// Where a page move of `count` pages from the caret height `caret_y` lands, as
/// `gtk_text_view_scroll_pages` in GTK 4.20 decides it (gtk/gtktextview.c, lines 6975-7000): a
/// move up from the top of the scroll range goes to the buffer start and one down from its bottom
/// to the buffer end; any other move shifts the height by `count` page increments, truncated to
/// whole pixels, without clamping it to the scroll range.
fn page_landing(caret_y: i32, count: i32, scroll: PageScroll) -> PageLanding {
    if count < 0 && scroll.value <= scroll.lower + 1e-12 {
        PageLanding::Start
    } else if count > 0 && scroll.value >= scroll.upper - scroll.page_size - 1e-12 {
        PageLanding::End
    } else {
        PageLanding::At((f64::from(caret_y) + f64::from(count) * scroll.page_increment) as i32)
    }
}

impl MarkdownView {
    /// Moves the caret `count` pages as GTK's page keys do, extending the selection when
    /// `extend` is set; `gtk_move` makes GTK's own move. A view that grows to its text inside a
    /// scroller, whose own page therefore holds the whole text, pages by that scroller's visible
    /// page instead. Unless the move extends the selection, the caret then goes onto the row at
    /// the landing height when that height lies on a rendered table.
    pub(super) fn move_pages(&self, count: i32, extend: bool, gtk_move: impl FnOnce()) {
        let outer = self.outer_scroller();
        if !self.is_cursor_visible() {
            match outer {
                Some(scroller) => {
                    let adjustment = scroller.vadjustment();
                    adjustment.set_value(
                        adjustment.value() + f64::from(count) * adjustment.page_increment(),
                    );
                }
                None => gtk_move(),
            }
            return;
        }
        let tables = if extend { None } else { self.table_paging() };
        let landing = match outer {
            Some(scroller) => Some(self.page_in(&scroller, count, extend)),
            None => self.gtk_page(count, gtk_move),
        };
        if let (Some(tables), Some(landing)) = (tables, landing) {
            self.finish_paging(tables, landing);
        }
    }

    /// The scroller that scrolls this view from outside, when the view sits inside it rather
    /// than scrolling itself.
    fn outer_scroller(&self) -> Option<gtk::ScrolledWindow> {
        let scroller = self
            .ancestor(gtk::ScrolledWindow::static_type())
            .and_downcast::<gtk::ScrolledWindow>()?;
        let scrolls_itself = scroller
            .child()
            .is_some_and(|child| &child == self.upcast_ref::<gtk::Widget>());
        (!scrolls_itself).then_some(scroller)
    }

    fn gtk_page(&self, count: i32, gtk_move: impl FnOnce()) -> Option<PageLanding> {
        let Some(own) = self.vadjustment() else {
            gtk_move();
            return None;
        };
        self.scroll_mark_onscreen(&self.buffer().get_insert());
        let (x, y) = self.page_aim();
        let landing = page_landing(y, count, PageScroll::from(&own));
        gtk_move();
        self.keep_aim(x, landing);
        Some(landing)
    }

    /// `gtk_text_view_scroll_pages` on `scroller`'s vertical adjustment: the caret keeps its
    /// height in the visible page while the page scrolls `count` page increments.
    fn page_in(&self, scroller: &gtk::ScrolledWindow, count: i32, extend: bool) -> PageLanding {
        self.scroll_caret_onscreen_in(scroller);
        let adjustment = scroller.vadjustment();
        let scroll = PageScroll::from(&adjustment);
        let (x, y) = self.page_aim();
        let landing = page_landing(y, count, scroll);
        let buffer = self.buffer();
        let target = match landing {
            PageLanding::Start => buffer.start_iter(),
            PageLanding::End => buffer.end_iter(),
            PageLanding::At(y) => {
                adjustment.set_value(scroll.value + f64::from(count) * scroll.page_increment);
                self.iter_nearest(x, y)
            }
        };
        let insert = buffer.get_insert();
        if buffer.iter_at_mark(&insert) == target {
            self.error_bell();
        }
        if extend {
            buffer.move_mark(&insert, &target);
        } else {
            buffer.place_cursor(&target);
        }
        self.keep_aim(x, landing);
        landing
    }

    /// Scrolls `scroller` the least distance that shows the whole caret.
    fn scroll_caret_onscreen_in(&self, scroller: &gtk::ScrolledWindow) {
        let (caret, _) = self.cursor_locations(None);
        let (x, y) =
            self.buffer_to_window_coords(gtk::TextWindowType::Widget, caret.x(), caret.y());
        let Some(point) = self.compute_point(scroller, &graphene::Point::new(x as f32, y as f32))
        else {
            return;
        };
        let adjustment = scroller.vadjustment();
        let top = adjustment.value() + f64::from(point.y());
        adjustment.clamp_page(top, top + f64::from(caret.height()));
    }

    /// Where a page move starts from: the last page move's aim while the caret stays where that
    /// move left it, else the caret's middle.
    fn page_aim(&self) -> (i32, i32) {
        let buffer = self.buffer();
        let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
        match self.imp().page_aim.get() {
            Some(aim) if aim.offset == offset => (aim.x, aim.y),
            _ => {
                let (caret, _) = self.cursor_locations(None);
                (caret.x(), caret.y() + caret.height() / 2)
            }
        }
    }

    fn keep_aim(&self, x: i32, landing: PageLanding) {
        let aim = match landing {
            PageLanding::At(y) => {
                let buffer = self.buffer();
                let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
                Some(PageAim { offset, x, y })
            }
            PageLanding::Start | PageLanding::End => None,
        };
        self.imp().page_aim.set(aim);
    }

    /// The position nearest to the buffer point (`x`, `y`), as GTK's own page moves pick it,
    /// also where no text lies there; `TextViewExt::iter_at_location` drops it in that case.
    fn iter_nearest(&self, x: i32, y: i32) -> gtk::TextIter {
        let mut iter = self.buffer().start_iter();
        // SAFETY: main thread; the view and the iter, which belongs to the view's buffer, outlive
        // the call, which only writes the iter.
        unsafe {
            gtk::ffi::gtk_text_view_get_iter_at_location(
                self.upcast_ref::<gtk::TextView>().to_glib_none().0,
                iter.to_glib_none_mut().0,
                x,
                y,
            );
        }
        iter
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCROLL: PageScroll = PageScroll {
        value: 400.0,
        lower: 0.0,
        upper: 2000.0,
        page_size: 500.0,
        page_increment: 450.0,
    };

    #[test]
    fn a_page_move_shifts_the_caret_height_by_page_increments() {
        assert_eq!(page_landing(300, 1, SCROLL), PageLanding::At(750));
        assert_eq!(page_landing(800, -1, SCROLL), PageLanding::At(350));
        assert_eq!(page_landing(300, 2, SCROLL), PageLanding::At(1200));
    }

    #[test]
    fn the_landing_height_is_truncated_to_whole_pixels() {
        let scroll = PageScroll {
            page_increment: 450.9,
            ..SCROLL
        };
        assert_eq!(page_landing(300, 1, scroll), PageLanding::At(750));
        assert_eq!(page_landing(800, -1, scroll), PageLanding::At(349));
    }

    #[test]
    fn the_landing_height_is_not_clamped_to_the_scroll_range() {
        let near_top = PageScroll {
            value: 100.0,
            ..SCROLL
        };
        assert_eq!(page_landing(120, -1, near_top), PageLanding::At(-330));
        let near_bottom = PageScroll {
            value: 1400.0,
            ..SCROLL
        };
        assert_eq!(page_landing(1800, 1, near_bottom), PageLanding::At(2250));
    }

    #[test]
    fn paging_up_from_the_top_lands_on_the_document_start() {
        let top = PageScroll {
            value: 0.0,
            ..SCROLL
        };
        assert_eq!(page_landing(120, -1, top), PageLanding::Start);
        assert_eq!(page_landing(120, 1, top), PageLanding::At(570));
    }

    #[test]
    fn paging_down_from_the_bottom_lands_on_the_document_end() {
        let bottom = PageScroll {
            value: 1500.0,
            ..SCROLL
        };
        assert_eq!(page_landing(1800, 1, bottom), PageLanding::End);
        assert_eq!(page_landing(1800, -1, bottom), PageLanding::At(1350));
    }

    #[test]
    fn a_page_shorter_than_its_view_pages_to_both_ends() {
        let short = PageScroll {
            value: 0.0,
            upper: 500.0,
            ..SCROLL
        };
        assert_eq!(page_landing(40, 1, short), PageLanding::End);
        assert_eq!(page_landing(40, -1, short), PageLanding::Start);
    }
}
