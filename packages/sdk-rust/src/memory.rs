// Generated from packages/core/schema/memory-search-output.schema.json by typify. Do not edit;
// run `POLYDEUKES_REGEN_IR=1 cargo test --test ir_generated` to regenerate.

///What `pdks memory search --json` prints on stdout at exit 0. An empty `results` is a search that found nothing; every failure exits non-zero with nothing on stdout. Objects stay open so a host built against this schema keeps reading a newer command's output.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct MemorySearchOutput {
    ///When the index being searched was last ingested, as an ISO 8601 timestamp.
    #[serde(rename = "ingestedAt")]
    pub ingested_at: ::std::string::String,
    ///The matched sections, in the command's ranking order.
    pub results: ::std::vec::Vec<MemorySearchResult>,
}
///One section found in the memory index.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct MemorySearchResult {
    ///The id of the document the section belongs to.
    #[serde(rename = "conceptId")]
    pub concept_id: ::std::string::String,
    ///The document's title.
    #[serde(rename = "docTitle")]
    pub doc_title: ::std::string::String,
    ///The section id: the document id, `#`, and the heading's slug.
    pub id: ::std::string::String,
    ///How the query matched: every word, some words, or a substring scan.
    #[serde(rename = "matchPath")]
    pub match_path: MemorySearchResultMatchPath,
    ///The section's heading.
    #[serde(rename = "sectionTitle")]
    pub section_title: ::std::string::String,
    ///Whether the document's `stale_after` date has passed.
    pub stale: bool,
    ///The document's status as its front matter states it.
    pub status: ::std::string::String,
    ///The documents that directly replace this section's document, sorted; empty when none.
    #[serde(rename = "supersededBy")]
    pub superseded_by: ::std::vec::Vec<::std::string::String>,
    ///Who verified the document: a human reviewer, a machine, or nobody.
    pub trust: MemorySearchResultTrust,
}
///How the query matched: every word, some words, or a substring scan.
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd
)]
pub enum MemorySearchResultMatchPath {
    #[serde(rename = "and")]
    And,
    #[serde(rename = "or")]
    Or,
    #[serde(rename = "like")]
    Like,
}
impl ::std::fmt::Display for MemorySearchResultMatchPath {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::And => f.write_str("and"),
            Self::Or => f.write_str("or"),
            Self::Like => f.write_str("like"),
        }
    }
}
impl ::std::str::FromStr for MemorySearchResultMatchPath {
    type Err = self::error::ConversionError;
    fn from_str(
        value: &str,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "and" => Ok(Self::And),
            "or" => Ok(Self::Or),
            "like" => Ok(Self::Like),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for MemorySearchResultMatchPath {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &str,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for MemorySearchResultMatchPath {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///Who verified the document: a human reviewer, a machine, or nobody.
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd
)]
pub enum MemorySearchResultTrust {
    #[serde(rename = "human-reviewed")]
    HumanReviewed,
    #[serde(rename = "machine-verified")]
    MachineVerified,
    #[serde(rename = "unverified")]
    Unverified,
}
impl ::std::fmt::Display for MemorySearchResultTrust {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::HumanReviewed => f.write_str("human-reviewed"),
            Self::MachineVerified => f.write_str("machine-verified"),
            Self::Unverified => f.write_str("unverified"),
        }
    }
}
impl ::std::str::FromStr for MemorySearchResultTrust {
    type Err = self::error::ConversionError;
    fn from_str(
        value: &str,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "human-reviewed" => Ok(Self::HumanReviewed),
            "machine-verified" => Ok(Self::MachineVerified),
            "unverified" => Ok(Self::Unverified),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for MemorySearchResultTrust {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &str,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for MemorySearchResultTrust {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
/// Error types.
pub mod error {
    /// Error from a `TryFrom` or `FromStr` implementation.
    pub struct ConversionError(::std::borrow::Cow<'static, str>);
    impl ::std::error::Error for ConversionError {}
    impl ::std::fmt::Display for ConversionError {
        fn fmt(
            &self,
            f: &mut ::std::fmt::Formatter<'_>,
        ) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl ::std::fmt::Debug for ConversionError {
        fn fmt(
            &self,
            f: &mut ::std::fmt::Formatter<'_>,
        ) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Debug::fmt(&self.0, f)
        }
    }
    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value.into())
        }
    }
    impl From<String> for ConversionError {
        fn from(value: String) -> Self {
            Self(value.into())
        }
    }
}
