use std::collections::HashMap;
use std::fmt::Write;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::services::{ServiceError, StagedInput, StagedInputs};

const ID_BYTES: usize = 16;

/// Clones share the same inputs: the app stages through one clone and the core takes through
/// another.
#[derive(Clone, Default)]
pub struct SharedStagedInputs {
    inputs: Arc<Mutex<HashMap<String, StagedInput>>>,
}

impl SharedStagedInputs {
    pub fn stage(&self, bytes: Vec<u8>, mime_type: impl Into<String>) -> String {
        let input = StagedInput {
            bytes,
            mime_type: mime_type.into(),
        };
        let mut inputs = self.inputs();
        let id = loop {
            let id = random_id();
            if !inputs.contains_key(&id) {
                break id;
            }
        };
        inputs.insert(id.clone(), input);
        id
    }

    pub fn discard<I>(&self, ids: I)
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        let mut inputs = self.inputs();
        for id in ids {
            inputs.remove(id.as_ref());
        }
    }

    pub fn clear(&self) {
        self.inputs().clear();
    }

    pub fn is_empty(&self) -> bool {
        self.inputs().is_empty()
    }

    fn inputs(&self) -> MutexGuard<'_, HashMap<String, StagedInput>> {
        self.inputs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn random_id() -> String {
    let mut bytes = [0u8; ID_BYTES];
    getrandom::fill(&mut bytes).expect("the system random source is available");
    bytes.iter().fold(String::new(), |mut id, byte| {
        let _ = write!(id, "{byte:02x}");
        id
    })
}

impl StagedInputs for SharedStagedInputs {
    fn take(&self, id: &str) -> Result<Option<StagedInput>, ServiceError> {
        Ok(self.inputs().remove(id))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn staged(inputs: &SharedStagedInputs, id: &str) -> Option<StagedInput> {
        inputs.take(id).unwrap()
    }

    #[test]
    fn an_input_is_taken_once() {
        let app = SharedStagedInputs::default();
        let core = app.clone();
        let id = app.stage(vec![1, 2, 3], "image/png");

        let taken = staged(&core, &id).unwrap();

        assert_eq!(taken.bytes, vec![1, 2, 3]);
        assert_eq!(taken.mime_type, "image/png");
        assert!(staged(&core, &id).is_none());
    }

    #[test]
    fn an_unknown_id_is_none() {
        let inputs = SharedStagedInputs::default();
        inputs.stage(vec![1], "");

        assert!(staged(&inputs, "0123456789abcdef0123456789abcdef").is_none());
    }

    #[test]
    fn discard_removes_only_the_given_ids() {
        let inputs = SharedStagedInputs::default();
        let kept = inputs.stage(vec![1], "");
        let dropped = inputs.stage(vec![2], "");
        let taken = inputs.stage(vec![3], "");
        staged(&inputs, &taken).unwrap();

        inputs.discard([&dropped, &taken]);

        assert!(staged(&inputs, &dropped).is_none());
        assert_eq!(staged(&inputs, &kept).unwrap().bytes, vec![1]);
    }

    #[test]
    fn clear_removes_everything() {
        let inputs = SharedStagedInputs::default();
        let first = inputs.stage(vec![1], "");
        let second = inputs.stage(vec![2], "");

        inputs.clear();

        assert!(inputs.is_empty());
        assert!(staged(&inputs, &first).is_none());
        assert!(staged(&inputs, &second).is_none());
    }

    #[test]
    fn ids_are_unique_lowercase_hex() {
        let inputs = SharedStagedInputs::default();

        let ids: HashSet<String> = (0..200).map(|_| inputs.stage(Vec::new(), "")).collect();

        assert_eq!(ids.len(), 200);
        assert!(ids.iter().all(|id| {
            id.len() == ID_BYTES * 2
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }));
    }
}
