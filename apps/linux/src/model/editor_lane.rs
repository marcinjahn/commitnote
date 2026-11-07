use std::cell::{Cell, RefCell};

use async_channel::{Receiver, Sender, bounded};

/// Orders the requests that move the editor, so the core sees them in the order the user acted
/// and a reply can tell whether a later move has replaced the one it belongs to.
#[derive(Default)]
pub struct EditorLane {
    moves: Cell<u64>,
    tail: RefCell<Option<Receiver<()>>>,
}

/// A place in the lane, held until dropped.
pub struct EditorTurn {
    stamp: u64,
    previous: Option<Receiver<()>>,
    _done: Sender<()>,
}

impl EditorLane {
    /// Reserves the next turn. A turn that moves the editor makes every earlier one stale.
    pub fn reserve(&self, moves_editor: bool) -> EditorTurn {
        if moves_editor {
            self.supersede();
        }
        let (done, finished) = bounded(1);
        EditorTurn {
            stamp: self.moves.get(),
            previous: self.tail.replace(Some(finished)),
            _done: done,
        }
    }

    pub fn supersede(&self) {
        self.moves.set(self.moves.get().wrapping_add(1));
    }

    pub fn is_current(&self, turn: &EditorTurn) -> bool {
        self.moves.get() == turn.stamp
    }
}

impl EditorTurn {
    /// Resolves once every earlier turn has been dropped.
    pub async fn begin(&mut self) {
        if let Some(previous) = self.previous.take() {
            let _ = previous.recv().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::pin::Pin;
    use std::task::{Context, Poll, Waker};

    use super::*;

    fn poll<F: Future>(future: &mut Pin<Box<F>>) -> Poll<F::Output> {
        future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
    }

    #[test]
    fn a_turn_waits_for_the_earlier_ones_whatever_order_they_ask_in() {
        let lane = EditorLane::default();
        let mut first = lane.reserve(true);
        let mut second = lane.reserve(true);
        let mut third = lane.reserve(true);

        let mut third_begin = Box::pin(third.begin());
        let mut second_begin = Box::pin(second.begin());
        assert!(poll(&mut third_begin).is_pending());
        assert!(poll(&mut second_begin).is_pending());

        let mut first_begin = Box::pin(first.begin());
        assert!(poll(&mut first_begin).is_ready());
        assert!(poll(&mut second_begin).is_pending());
        drop(first_begin);
        drop(first);

        assert!(poll(&mut second_begin).is_ready());
        assert!(poll(&mut third_begin).is_pending());
        drop(second_begin);
        drop(second);

        assert!(poll(&mut third_begin).is_ready());
    }

    #[test]
    fn a_dropped_turn_never_blocks_the_ones_behind_it() {
        let lane = EditorLane::default();
        let first = lane.reserve(true);
        let mut second = lane.reserve(true);
        let mut begin = Box::pin(second.begin());
        assert!(poll(&mut begin).is_pending());

        drop(first);

        assert!(poll(&mut begin).is_ready());
    }

    #[test]
    fn only_a_later_move_makes_a_turn_stale() {
        let lane = EditorLane::default();
        let start = lane.reserve(true);
        let leave = lane.reserve(false);
        assert!(lane.is_current(&start));
        assert!(lane.is_current(&leave));

        let open = lane.reserve(true);

        assert!(!lane.is_current(&start));
        assert!(!lane.is_current(&leave));
        assert!(lane.is_current(&open));

        lane.supersede();
        assert!(!lane.is_current(&open));
    }
}
