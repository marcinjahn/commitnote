/// What one primary press on a table amounts to, in widget coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum PressOutcome {
    Click { x: f64, y: f64 },
    Drag { from: (f64, f64), to: (f64, f64) },
    LongPress { x: f64, y: f64 },
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
enum PressState {
    #[default]
    Idle,
    Pressed {
        start: (f64, f64),
    },
    Dragging {
        start: (f64, f64),
    },
    LongPressed,
}

/// Tells a click from a drag and a long press across the events of one press, given its start and
/// the offsets reported since.
#[derive(Debug, Default)]
pub(super) struct PressSequence {
    state: PressState,
}

impl PressSequence {
    pub(super) fn begin(&mut self, x: f64, y: f64) {
        self.state = PressState::Pressed { start: (x, y) };
    }

    pub(super) fn update(&mut self, dx: f64, dy: f64, threshold: i32) -> Option<PressOutcome> {
        match self.state {
            PressState::Pressed { start } => {
                let to = offset(start, dx, dy);
                if within_drag_threshold(start, to, threshold) {
                    return None;
                }
                self.state = PressState::Dragging { start };
                Some(PressOutcome::Drag { from: start, to })
            }
            PressState::Dragging { start } => Some(PressOutcome::Drag {
                from: start,
                to: offset(start, dx, dy),
            }),
            PressState::Idle | PressState::LongPressed => None,
        }
    }

    pub(super) fn end(&mut self, dx: f64, dy: f64, threshold: i32) -> Option<PressOutcome> {
        match std::mem::take(&mut self.state) {
            PressState::Pressed { start } => {
                let to = offset(start, dx, dy);
                Some(if within_drag_threshold(start, to, threshold) {
                    PressOutcome::Click { x: to.0, y: to.1 }
                } else {
                    PressOutcome::Drag { from: start, to }
                })
            }
            PressState::Dragging { start } => Some(PressOutcome::Drag {
                from: start,
                to: offset(start, dx, dy),
            }),
            PressState::Idle | PressState::LongPressed => None,
        }
    }

    pub(super) fn long_press(&mut self, x: f64, y: f64) -> Option<PressOutcome> {
        if matches!(self.state, PressState::Dragging { .. }) {
            return None;
        }
        self.state = PressState::LongPressed;
        Some(PressOutcome::LongPress { x, y })
    }

    pub(super) fn cancel(&mut self) {
        self.state = PressState::Idle;
    }
}

fn offset(start: (f64, f64), dx: f64, dy: f64) -> (f64, f64) {
    (start.0 + dx, start.1 + dy)
}

/// Whether a release `threshold` pixels or less from its press on both axes is still a click.
pub(super) fn within_drag_threshold(
    pressed: (f64, f64),
    released: (f64, f64),
    threshold: i32,
) -> bool {
    let threshold = f64::from(threshold);
    (released.0 - pressed.0).abs() <= threshold && (released.1 - pressed.1).abs() <= threshold
}

#[cfg(test)]
mod tests {
    use super::{PressOutcome, PressSequence, within_drag_threshold};

    const THRESHOLD: i32 = 8;

    #[derive(Debug, Clone, Copy)]
    enum Event {
        Begin(f64, f64),
        Update(f64, f64),
        End(f64, f64),
        LongPress(f64, f64),
        Cancel,
    }

    use Event::{Begin, Cancel, End, LongPress, Update};

    /// A name, the events of a press and the outcome of each.
    type Case<'a> = (&'a str, &'a [Event], &'a [Option<PressOutcome>]);

    fn click(x: f64, y: f64) -> Option<PressOutcome> {
        Some(PressOutcome::Click { x, y })
    }

    fn drag(from: (f64, f64), to: (f64, f64)) -> Option<PressOutcome> {
        Some(PressOutcome::Drag { from, to })
    }

    fn long_press(x: f64, y: f64) -> Option<PressOutcome> {
        Some(PressOutcome::LongPress { x, y })
    }

    fn outcomes(events: &[Event]) -> Vec<Option<PressOutcome>> {
        let mut press = PressSequence::default();
        events
            .iter()
            .map(|event| match *event {
                Begin(x, y) => {
                    press.begin(x, y);
                    None
                }
                Update(dx, dy) => press.update(dx, dy, THRESHOLD),
                End(dx, dy) => press.end(dx, dy, THRESHOLD),
                LongPress(x, y) => press.long_press(x, y),
                Cancel => {
                    press.cancel();
                    None
                }
            })
            .collect()
    }

    #[test]
    fn a_release_at_the_press_is_a_click() {
        assert!(within_drag_threshold((10.0, 20.0), (10.0, 20.0), 8));
    }

    #[test]
    fn a_release_up_to_the_threshold_away_on_both_axes_is_a_click() {
        assert!(within_drag_threshold((10.0, 20.0), (18.0, 12.0), 8));
        assert!(within_drag_threshold((10.0, 20.0), (2.0, 28.0), 8));
    }

    #[test]
    fn a_release_past_the_threshold_on_either_axis_is_a_drag() {
        assert!(!within_drag_threshold((10.0, 20.0), (18.5, 20.0), 8));
        assert!(!within_drag_threshold((10.0, 20.0), (10.0, 11.5), 8));
        assert!(!within_drag_threshold((10.0, 20.0), (40.0, 50.0), 8));
    }

    #[test]
    fn each_event_sequence_has_its_outcomes() {
        let cases: &[Case<'_>] = &[
            (
                "a release at the press is a click",
                &[Begin(10.0, 20.0), End(0.0, 0.0)],
                &[None, click(10.0, 20.0)],
            ),
            (
                "moves within the threshold stay a click at the release point",
                &[Begin(10.0, 20.0), Update(5.0, -8.0), End(8.0, 8.0)],
                &[None, None, click(18.0, 28.0)],
            ),
            (
                "an update past the threshold drags, and every later update and the end drag",
                &[
                    Begin(10.0, 20.0),
                    Update(8.5, 0.0),
                    Update(1.0, 1.0),
                    Update(-30.0, 40.0),
                    End(2.0, 0.0),
                ],
                &[
                    None,
                    drag((10.0, 20.0), (18.5, 20.0)),
                    drag((10.0, 20.0), (11.0, 21.0)),
                    drag((10.0, 20.0), (-20.0, 60.0)),
                    drag((10.0, 20.0), (12.0, 20.0)),
                ],
            ),
            (
                "an end past the threshold with no update drags",
                &[Begin(10.0, 20.0), End(0.0, -9.0)],
                &[None, drag((10.0, 20.0), (10.0, 11.0))],
            ),
            (
                "a long press then a release is no click",
                &[Begin(10.0, 20.0), LongPress(10.0, 20.0), End(0.0, 0.0)],
                &[None, long_press(10.0, 20.0), None],
            ),
            (
                "a long press then a move is no drag",
                &[
                    Begin(10.0, 20.0),
                    LongPress(10.0, 20.0),
                    Update(40.0, 40.0),
                    End(40.0, 40.0),
                ],
                &[None, long_press(10.0, 20.0), None, None],
            ),
            (
                "a long press while dragging is ignored and the drag goes on",
                &[
                    Begin(10.0, 20.0),
                    Update(20.0, 0.0),
                    LongPress(30.0, 20.0),
                    Update(25.0, 0.0),
                    End(25.0, 0.0),
                ],
                &[
                    None,
                    drag((10.0, 20.0), (30.0, 20.0)),
                    None,
                    drag((10.0, 20.0), (35.0, 20.0)),
                    drag((10.0, 20.0), (35.0, 20.0)),
                ],
            ),
            (
                "a cancel mid-drag ends the press without an outcome",
                &[
                    Begin(10.0, 20.0),
                    Update(20.0, 0.0),
                    Cancel,
                    Update(30.0, 0.0),
                    End(0.0, 0.0),
                ],
                &[None, drag((10.0, 20.0), (30.0, 20.0)), None, None, None],
            ),
            (
                "a cancel before any move ends the press without a click",
                &[Begin(10.0, 20.0), Cancel, End(0.0, 0.0)],
                &[None, None, None],
            ),
            (
                "events with no press have no outcome",
                &[Update(20.0, 0.0), End(0.0, 0.0), Cancel, End(20.0, 0.0)],
                &[None, None, None, None],
            ),
            (
                "a long press with no press still selects",
                &[LongPress(10.0, 20.0), End(0.0, 0.0)],
                &[long_press(10.0, 20.0), None],
            ),
            (
                "a press after a long press starts clean",
                &[
                    Begin(10.0, 20.0),
                    LongPress(10.0, 20.0),
                    End(0.0, 0.0),
                    Begin(50.0, 60.0),
                    End(1.0, 1.0),
                ],
                &[None, long_press(10.0, 20.0), None, None, click(51.0, 61.0)],
            ),
            (
                "a press after a cancel starts clean",
                &[
                    Begin(10.0, 20.0),
                    Update(20.0, 0.0),
                    Cancel,
                    Begin(50.0, 60.0),
                    End(0.0, 0.0),
                ],
                &[
                    None,
                    drag((10.0, 20.0), (30.0, 20.0)),
                    None,
                    None,
                    click(50.0, 60.0),
                ],
            ),
            (
                "a press after a drag starts clean",
                &[
                    Begin(10.0, 20.0),
                    End(20.0, 0.0),
                    Begin(50.0, 60.0),
                    Update(1.0, 0.0),
                    End(0.0, 0.0),
                ],
                &[
                    None,
                    drag((10.0, 20.0), (30.0, 20.0)),
                    None,
                    None,
                    click(50.0, 60.0),
                ],
            ),
            (
                "a new press mid-drag restarts from its own point",
                &[
                    Begin(10.0, 20.0),
                    Update(20.0, 0.0),
                    Begin(50.0, 60.0),
                    End(0.0, 0.0),
                ],
                &[
                    None,
                    drag((10.0, 20.0), (30.0, 20.0)),
                    None,
                    click(50.0, 60.0),
                ],
            ),
        ];
        for (name, events, expected) in cases {
            assert_eq!(outcomes(events), *expected, "{name}");
        }
    }

    #[test]
    fn a_press_clicks_at_most_once_and_never_after_a_drag_a_long_press_or_a_cancel() {
        let middles = [
            Update(20.0, 0.0),
            Update(1.0, 0.0),
            LongPress(10.0, 20.0),
            Cancel,
            End(1.0, 0.0),
        ];
        for first in middles {
            for second in middles {
                for third in middles {
                    let sequence = [
                        Begin(10.0, 20.0),
                        first,
                        second,
                        third,
                        End(0.0, 0.0),
                        Begin(50.0, 60.0),
                        End(0.0, 0.0),
                    ];
                    let got = outcomes(&sequence);
                    let mut interrupted = false;
                    let mut clicks = 0;
                    for (event, outcome) in sequence.iter().zip(&got) {
                        match (event, outcome) {
                            (Begin(..), _) => {
                                interrupted = false;
                                clicks = 0;
                            }
                            (Cancel, _)
                            | (
                                _,
                                Some(PressOutcome::Drag { .. } | PressOutcome::LongPress { .. }),
                            ) => {
                                interrupted = true;
                            }
                            (_, Some(PressOutcome::Click { .. })) => {
                                clicks += 1;
                                assert!(!interrupted && clicks == 1, "{sequence:?} -> {got:?}");
                            }
                            _ => {}
                        }
                    }
                    assert_eq!(got.last(), Some(&click(50.0, 60.0)), "{sequence:?}");
                }
            }
        }
    }
}
