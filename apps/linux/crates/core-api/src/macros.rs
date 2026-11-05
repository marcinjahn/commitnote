macro_rules! command {
    ($name:ident, $wire:literal, $params:ty, $result:ty) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub struct $name;

        impl $crate::commands::Command for $name {
            const NAME: &'static str = $wire;
            type Params = $params;
            type Result = $result;
        }
    };
}

macro_rules! empty_shape {
    ($($name:ident),+ $(,)?) => {
        $(
            #[derive(
                Debug,
                Clone,
                Default,
                PartialEq,
                Eq,
                serde::Serialize,
                serde::Deserialize,
            )]
            pub struct $name {}
        )+
    };
}
