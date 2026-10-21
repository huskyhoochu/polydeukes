//! Executable selection is shared by all four verbs. Runtime package discovery and a Node
//! launcher would change the standalone process contract even when a seam reports success.

const LIB: &str = include_str!("../src/lib.rs");

#[test]
fn execution_does_not_discover_npm_packages_or_launch_node() {
    // A second launcher could pass injected seam tests while requiring Node on a real host.
    for literal in [
        "\"node\"",
        "node_modules",
        "package.json",
        "find_umbrella_bin(",
    ] {
        assert!(
            !LIB.contains(literal),
            "unexpected runtime discovery: {literal}"
        );
    }
}

#[test]
fn all_verbs_use_one_executable_resolver() {
    // Multiple resolver definitions allow memory and covenant selection to drift apart.
    let definitions = LIB.matches("fn resolve_executable(").count();
    assert_eq!(definitions, 1, "one definition of the shared resolver");
    assert_eq!(
        LIB.matches("resolve_executable(").count() - definitions,
        2,
        "covenant and memory runners share the resolver"
    );
    assert_eq!(
        LIB.matches("fn default_spawn(").count(),
        1,
        "one default process runner"
    );
    assert_eq!(
        LIB.matches("default_spawn(").count(),
        2,
        "one call to the default process runner"
    );
}
