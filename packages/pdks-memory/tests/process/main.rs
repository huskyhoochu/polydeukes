//! Process tests of the `pdks-memory` executable: each test writes a project into a temporary
//! directory and runs the built binary in it.

mod common;
mod config;
mod corpus;
mod errors;
mod expand;
mod links;
mod lint;
mod log;
mod obligations;
mod search;
mod show;
mod stats;
mod supersession;
mod ticket;
mod usage;
mod wikilinks;
