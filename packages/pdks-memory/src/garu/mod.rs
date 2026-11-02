// Vendored from https://github.com/ongjin/garu at 3229d92a20622bbe83779d94faf9e58b80c62ec0, crates/garu-core/src/lib.rs.
// MIT License, Copyright (c) 2026 Yongjin Cho; see models/GARU-LICENSE.
// models/GARU-LICENSE covers this module's code and models/garu-base.gmdl.
pub mod codebook;
pub mod rerank;
pub mod trie;
pub mod types;
pub mod model;
mod nng_hints;

pub use model::AnalyzerOptions;
