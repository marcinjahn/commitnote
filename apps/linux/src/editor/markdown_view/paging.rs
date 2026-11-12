use commitnote_markdown::VerticalDirection;
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

/// A Vim page move: the scroll value it ends at and where the caret goes.
#[derive(Debug, Clone, Copy, PartialEq)]
struct VimPageMove {
    value: f64,
    caret: VimCaret,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum VimCaret {
    Stays,
    /// To the start of the line at this height, the top of the page.
    PageTop(f64),
    /// To the start of the last line wholly above this height, the bottom of the page.
    PageBottom(f64),
    /// By this distance, keeping its place in the page.
    Shifted(f64),
}

/// How GtkSourceView 5.18 pages for Vim, `pages` pages down (or up when negative), where the
/// caret spans `caret_top` and `caret_height` in the same coordinates as `scroll`
/// (gtksourceview/vim/gtksourcevimstate.c).
///
/// A full page is `gtk_source_vim_state_scroll_page`: each page brings the line at the bottom
/// edge to the top, or the one at the top edge to the bottom, then
/// `gtk_source_vim_state_place_cursor_onscreen` moves a caret the page left behind to the line at
/// the edge it went past. A half page is `gtk_source_vim_state_scroll_half_page`: each half page
/// brings the middle line to the top or bottom edge, and the caret keeps its place in the page.
/// Both align the page to whole lines, which this leaves out, so it lands within a line of them.
fn vim_page_move(
    caret_top: f64,
    caret_height: f64,
    pages: i32,
    half: bool,
    scroll: PageScroll,
) -> VimPageMove {
    let step = if half {
        scroll.page_size / 2.0
    } else {
        scroll.page_size
    };
    let last = (scroll.upper - scroll.page_size).max(scroll.lower);
    let value = (scroll.value + f64::from(pages) * step).clamp(scroll.lower, last);
    let bottom = value + scroll.page_size;
    let caret = if half {
        VimCaret::Shifted(value - scroll.value)
    } else if caret_top < value {
        VimCaret::PageTop(value)
    } else if caret_top + caret_height > bottom {
        VimCaret::PageBottom(bottom)
    } else {
        VimCaret::Stays
    };
    VimPageMove { value, caret }
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

    /// Moves the page and the caret `count` pages, or half pages, as Vim's `<C-f>`, `<C-b>`,
    /// `<C-d>` and `<C-u>` do, then onto the row at the caret's landing height when that height
    /// lies on a rendered table; says whether it did. It does only for a view that grows to its
    /// text inside a scroller, where GtkSourceView's own paging, which pages the view's own page
    /// holding the whole text, moves nothing.
    pub fn vim_page(&self, direction: VerticalDirection, half: bool, count: usize) -> bool {
        let Some(scroller) = self.outer_scroller() else {
            return false;
        };
        if !self.is_cursor_visible() {
            return false;
        }
        let tables = self.table_paging();
        self.scroll_caret_onscreen_in(&scroller);
        let Some(origin) = self.content_origin_in(&scroller) else {
            return false;
        };
        let count = i32::try_from(count).unwrap_or(i32::MAX);
        let pages = match direction {
            VerticalDirection::Down => count,
            VerticalDirection::Up => -count,
        };
        let adjustment = scroller.vadjustment();
        let (caret, _) = self.cursor_locations(None);
        let page_move = vim_page_move(
            origin + f64::from(caret.y()),
            f64::from(caret.height()),
            pages,
            half,
            PageScroll::from(&adjustment),
        );
        adjustment.set_value(page_move.value);
        let to_buffer = |y: f64| (y - origin).floor() as i32;
        let (target, landing) = match page_move.caret {
            VimCaret::Stays => (None, caret.y() + caret.height() / 2),
            VimCaret::PageTop(top) => {
                let y = to_buffer(top);
                let (line, _) = self.line_at_y(y);
                (Some(past_blanks(line)), y)
            }
            VimCaret::PageBottom(bottom) => {
                let y = to_buffer(bottom);
                let (mut line, line_top) = self.line_at_y(y);
                let (_, height) = self.line_yrange(&line);
                if line_top + height > y {
                    line.backward_line();
                }
                (Some(past_blanks(line)), y - 1)
            }
            VimCaret::Shifted(by) => {
                let y = caret.y() + caret.height() / 2 + by.round() as i32;
                (Some(self.iter_nearest(caret.x(), y)), y)
            }
        };
        if let Some(target) = target {
            self.buffer().place_cursor(&target);
        }
        if let Some(tables) = tables {
            self.finish_paging(tables, PageLanding::At(landing));
        }
        self.imp().page_aim.set(None);
        true
    }

    /// The content height in `scroller` of the buffer's top.
    fn content_origin_in(&self, scroller: &gtk::ScrolledWindow) -> Option<f64> {
        let (x, y) = self.buffer_to_window_coords(gtk::TextWindowType::Widget, 0, 0);
        let point = self.compute_point(scroller, &graphene::Point::new(x as f32, y as f32))?;
        Some(scroller.vadjustment().value() + f64::from(point.y()))
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

fn past_blanks(mut iter: gtk::TextIter) -> gtk::TextIter {
    while !iter.ends_line() && iter.char().is_whitespace() {
        iter.forward_char();
    }
    iter
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

    fn vim_scroll(value: f64) -> PageScroll {
        PageScroll {
            value,
            lower: 0.0,
            upper: 3000.0,
            page_size: 600.0,
            page_increment: 540.0,
        }
    }

    #[test]
    fn a_vim_page_scrolls_whole_pages_and_takes_a_caret_left_above_to_the_top() {
        assert_eq!(
            vim_page_move(1050.0, 20.0, 1, false, vim_scroll(1000.0)),
            VimPageMove {
                value: 1600.0,
                caret: VimCaret::PageTop(1600.0),
            }
        );
        assert_eq!(
            vim_page_move(1050.0, 20.0, 2, false, vim_scroll(1000.0)).value,
            2200.0
        );
    }

    #[test]
    fn a_vim_page_up_takes_a_caret_left_below_to_the_bottom() {
        assert_eq!(
            vim_page_move(1500.0, 20.0, -1, false, vim_scroll(1000.0)),
            VimPageMove {
                value: 400.0,
                caret: VimCaret::PageBottom(1000.0),
            }
        );
    }

    #[test]
    fn a_vim_page_leaves_a_caret_the_new_page_still_shows() {
        let near_bottom = PageScroll {
            upper: 800.0,
            ..vim_scroll(100.0)
        };
        assert_eq!(
            vim_page_move(250.0, 20.0, 1, false, near_bottom),
            VimPageMove {
                value: 200.0,
                caret: VimCaret::Stays,
            }
        );
    }

    #[test]
    fn a_vim_half_page_shifts_the_caret_with_the_page() {
        assert_eq!(
            vim_page_move(1050.0, 20.0, 1, true, vim_scroll(1000.0)),
            VimPageMove {
                value: 1300.0,
                caret: VimCaret::Shifted(300.0),
            }
        );
        assert_eq!(
            vim_page_move(1050.0, 20.0, -3, true, vim_scroll(1000.0)),
            VimPageMove {
                value: 100.0,
                caret: VimCaret::Shifted(-900.0),
            }
        );
    }

    #[test]
    fn a_vim_page_stops_at_the_ends_of_the_scroll_range() {
        assert_eq!(
            vim_page_move(2500.0, 20.0, 1, true, vim_scroll(2300.0)),
            VimPageMove {
                value: 2400.0,
                caret: VimCaret::Shifted(100.0),
            }
        );
        assert_eq!(
            vim_page_move(50.0, 20.0, -1, false, vim_scroll(0.0)),
            VimPageMove {
                value: 0.0,
                caret: VimCaret::Stays,
            }
        );
    }

    #[test]
    fn a_vim_page_in_a_page_taller_than_its_text_stays_put() {
        let short = PageScroll {
            upper: 300.0,
            ..vim_scroll(0.0)
        };
        assert_eq!(
            vim_page_move(100.0, 20.0, 2, false, short),
            VimPageMove {
                value: 0.0,
                caret: VimCaret::Stays,
            }
        );
    }

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
