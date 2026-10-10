//! The four verbs decide what to run — `node` and the umbrella's bin path — in one internal
//! function, so a change to how the executable is chosen is one edit and no verb's signature
//! moves. The crate text is the only place that invariant is visible: a second `"node"`
//! literal, or a second call into the bin lookup, is a verb that resolves on its own.

const LIB: &str = include_str!("../src/lib.rs");

#[test]
fn the_node_literal_appears_once_in_lib_rs() {
    // A memory verb that spells `"node"` itself keeps working today and silently misses the
    // next change to the resolution function.
    assert_eq!(
        LIB.matches("\"node\"").count(),
        1,
        "\"node\" literals in src/lib.rs"
    );
}

#[test]
fn find_umbrella_bin_is_called_from_one_site() {
    // The definition is one occurrence of the name; every other occurrence is a call. Two
    // calls are two verbs each walking the install graph on their own.
    let occurrences = LIB.matches("find_umbrella_bin(").count();
    let definitions = LIB.matches("fn find_umbrella_bin(").count();
    assert_eq!(definitions, 1, "one definition of find_umbrella_bin");
    assert_eq!(
        occurrences - definitions,
        1,
        "call sites of find_umbrella_bin"
    );
}
