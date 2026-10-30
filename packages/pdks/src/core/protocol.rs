use serde_json::Value;

pub struct ToolCall {
    pub name: String,
    pub args: Option<Value>,
    pub cwd: Option<String>,
    pub file_change: Option<Value>,
}

/// The input IR as parsed. `tools` and `session` stay raw: the runner validates their shape.
pub struct Input {
    pub tool_calls: Vec<ToolCall>,
    pub has_world: bool,
    pub actor: Option<Value>,
    pub tools: Option<Value>,
    pub session: Option<Value>,
}

const MALFORMED_TOOL_CALL: &str = "input carries a malformed tool call";

pub fn parse_input(text: &str) -> Result<Input, String> {
    let parsed: Value =
        serde_json::from_str(text).map_err(|error| format!("input is not JSON: {error}"))?;
    let Value::Object(mut object) = parsed else {
        return Err("input is not a JSON object".to_string());
    };
    let Some(Value::Array(calls)) = object.remove("toolCalls") else {
        return Err("input carries no toolCalls array".to_string());
    };
    for key in ["subagentSpawns", "userMessages"] {
        if !object.get(key).is_some_and(Value::is_array) {
            return Err(format!("input carries no {key} array"));
        }
    }

    let mut tool_calls = Vec::with_capacity(calls.len());
    for call in calls {
        let Value::Object(mut call) = call else {
            return Err(MALFORMED_TOOL_CALL.to_string());
        };
        let Some(Value::String(name)) = call.remove("name") else {
            return Err(MALFORMED_TOOL_CALL.to_string());
        };
        let cwd = match call.remove("cwd") {
            None => None,
            Some(Value::String(cwd)) => Some(cwd),
            Some(_) => return Err("input carries a malformed tool-call cwd".to_string()),
        };
        tool_calls.push(ToolCall {
            name,
            args: call.remove("args"),
            cwd,
            file_change: call.remove("fileChange"),
        });
    }

    if let Some(actor) = object.get("actor") {
        let well_formed = actor.as_object().is_some_and(|fields| {
            fields
                .iter()
                .all(|(key, value)| key == "agentType" && value.is_string())
        });
        if !well_formed {
            return Err("input carries a malformed actor".to_string());
        }
    }

    Ok(Input {
        tool_calls,
        has_world: object.contains_key("world"),
        actor: object.remove("actor"),
        tools: object.remove("tools"),
        session: object.remove("session"),
    })
}
