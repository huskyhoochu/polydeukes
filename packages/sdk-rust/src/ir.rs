// Generated from packages/core/schema/covenant-input.schema.json by typify. Do not edit;
// run `POLYDEUKES_REGEN_IR=1 cargo test --test ir_generated` to regenerate.

///Who made the observation. `agentType` is the subagent kind when the call comes from one; the empty object is the main session.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Actor {
    #[serde(
        rename = "agentType",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub agent_type: ::std::option::Option<::std::string::String>,
}
///Evidence channel texts by kind. `sidecar` is the spawn-record list as JSON text: `'[]'` says the channel observed no spawn, an absent key says there is no channel.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Channels {
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub sidecar: ::std::option::Option<::std::string::String>,
}
///The input a host sends to `pdks covenant check` on stdin. Any document this schema accepts, the command reads without refusing; `world` is absent because the command fills that axis itself.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CovenantInput {
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub actor: ::std::option::Option<Actor>,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub session: ::std::option::Option<Session>,
    ///The subagents the observed turn spawned.
    #[serde(rename = "subagentSpawns")]
    pub subagent_spawns: ::std::vec::Vec<SubagentSpawn>,
    ///The judged tool calls, each carrying its own file-change evidence when the adapter has it.
    #[serde(rename = "toolCalls")]
    pub tool_calls: ::std::vec::Vec<ToolCall>,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub tools: ::std::option::Option<Tools>,
    ///The user messages the observed turn carries.
    #[serde(rename = "userMessages")]
    pub user_messages: ::std::vec::Vec<UserMessage>,
}
///One file's mutation evidence around the judged call, discriminated by `kind`. `delete.pre` is the text baseline when one exists, absent for a binary blob.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum FileChange {
    #[serde(rename = "create")]
    Create { path: ::std::string::String, post: ::std::string::String },
    #[serde(rename = "modify")]
    Modify {
        path: ::std::string::String,
        post: ::std::string::String,
        pre: ::std::string::String,
    },
    #[serde(rename = "delete")]
    Delete {
        path: ::std::string::String,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        pre: ::std::option::Option<::std::string::String>,
    },
}
///The evidence a live agent session carries that the repository's disk does not. A session whose lists are empty is a host that named its evidence and could not deliver it.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Session {
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub channels: ::std::option::Option<Channels>,
    ///Where the session evidence was read from.
    #[serde(
        rename = "evidencePath",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub evidence_path: ::std::option::Option<::std::string::String>,
    #[serde(rename = "toolCalls")]
    pub tool_calls: ::std::vec::Vec<SessionToolCall>,
    #[serde(rename = "userMessages")]
    pub user_messages: ::std::vec::Vec<SessionUserMessage>,
}
///One session tool call, with its outcome when the session proves it.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionToolCall {
    #[serde(default, skip_serializing_if = "::serde_json::Map::is_empty")]
    pub args: ::serde_json::Map<::std::string::String, ::serde_json::Value>,
    pub name: ::std::string::String,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub succeeded: ::std::option::Option<bool>,
}
///One session user message, with the time it was sent when the session proves it.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionUserMessage {
    pub text: ::std::string::String,
    ///Milliseconds since the Unix epoch.
    #[serde(
        rename = "timestampMs",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub timestamp_ms: ::std::option::Option<f64>,
}
///One subagent spawn; `kind` is the subagent name the adapter fills in.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SubagentSpawn {
    pub kind: ::std::string::String,
}
///One tool call; an absent `fileChange` means the call is unproven, and no sibling call's evidence stands in for it.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ToolCall {
    ///The call's arguments as the host passed them.
    #[serde(default, skip_serializing_if = "::serde_json::Map::is_empty")]
    pub args: ::serde_json::Map<::std::string::String, ::serde_json::Value>,
    #[serde(
        rename = "fileChange",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub file_change: ::std::option::Option<FileChange>,
    ///The tool name the host reports.
    pub name: ::std::string::String,
}
///The host's tool roster: `mutating` names the tools whose calls change a file, `shell` the ones carrying a command line, and `commandArgs` the argument keys that command line travels in. A non-empty `shell` needs a non-empty `commandArgs`, since a shell call's command line is read from those keys.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Tools {
    #[serde(rename = "commandArgs")]
    pub command_args: ::std::vec::Vec<::std::string::String>,
    pub mutating: ::std::vec::Vec<::std::string::String>,
    pub shell: ::std::vec::Vec<::std::string::String>,
}
///One user message's text.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct UserMessage {
    pub text: ::std::string::String,
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
