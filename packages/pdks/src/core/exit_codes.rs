/// How a `covenant check` run ends. `main` maps it to the process exit code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Exit {
    Uphold,
    Blocked,
    InputUnreadable,
}

impl Exit {
    pub fn code(self) -> u8 {
        match self {
            Self::Uphold => 0,
            Self::Blocked => 2,
            Self::InputUnreadable => 3,
        }
    }
}
