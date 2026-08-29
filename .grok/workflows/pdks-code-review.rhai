let meta = #{
    name: "pdks-code-review",
    description: "Grok port of the ticket-loop review: Scope, parallel finders, independent verify, optional sweep, capped synthesis",
    when_to_use: "Ticket PR phase on Grok Build. Same topology as .claude/workflows/pdks-code-review.js. Args: target (PR number, branch, or git range), optional level (high|xhigh), optional context (PRD invariants).",
    phases: [
        #{ title: "Scope", detail: "Pin the diff command, changed files, and governing docs" },
        #{ title: "Find", detail: "One finder per correctness angle plus one cleanup finder" },
        #{ title: "Verify", detail: "One independent verifier per candidate" },
        #{ title: "Sweep", detail: "Gap finder (xhigh only)" },
        #{ title: "Synthesize", detail: "Drop REFUTED, rank, cap the report" },
    ],
};

let scope_schema = #{
    "type": "object", "required": ["diffCommand", "files", "summary"],
    "properties": #{
        "diffCommand": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "docs": #{ "type": "string" },
    },
};
let candidates_schema = #{
    "type": "object", "required": ["candidates"],
    "properties": #{
        "candidates": #{ "type": "array", "maxItems": 12, "items": #{
            "type": "object", "required": ["file", "summary", "failure_scenario"],
            "properties": #{
                "file": #{ "type": "string" },
                "line": #{ "type": "number" },
                "summary": #{ "type": "string" },
                "failure_scenario": #{ "type": "string" },
            },
        }},
    },
};
let verdict_schema = #{
    "type": "object", "required": ["verdict", "evidence"],
    "properties": #{
        "verdict": #{ "enum": ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
        "evidence": #{ "type": "string" },
    },
};
let report_schema = #{
    "type": "object", "required": ["summary", "keep"],
    "properties": #{
        "summary": #{ "type": "string" },
        "keep": #{ "type": "array", "items": #{ "type": "number" } },
    },
};

fn trimmed(s) {
    if type_of(s) == "string" { s.trim(); s } else { "" }
}

fn encode(v) {
    json_encode(v)
}

let target = ();
let level = "high";
let extra = "";
if args != () {
    if args.target != () { target = args.target; }
    if args.level != () {
        let lv = trimmed(args.level);
        if lv == "xhigh" || lv == "max" { level = "xhigh"; }
    }
    if args.context != () { extra = trimmed(args.context); }
}
if target == () { pause("verification", "Pass args.target — a PR number, branch, or git range."); }

let per_angle = 6;
let max_findings = 10;
let do_sweep = false;
let n_correct = 3;
if level == "xhigh" {
    per_angle = 8;
    max_findings = 15;
    do_sweep = true;
    n_correct = 5;
}

let constraints = "";
constraints += "Project review constraints (binding):\n";
constraints += "1. Finite domain. A finding must name a code path or an enumerated list. ";
constraints += "Sampling an infinite input space is a hypothesis, not a defect.\n";
constraints += "2. What the fix costs. Name what the owner loses (a file they can no longer ";
constraints += "edit freely, a command that now refuses). A finding that names only the risk ";
constraints += "has reported half of itself. Self-imposed disciplines: a fix that removes the ";
constraints += "owner's choice is a regression even when the risk is real.\n";
constraints += "3. Vocabulary: covenant / discipline / witness — never guard, harness, kb, waive.\n";
constraints += "4. Reviewer confidence is hypothesis strength. The orchestrating session judges ";
constraints += "each surviving finding against the PRD text.\n";
if extra != "" {
    constraints += "5. Ticket context (verbatim):\n";
    constraints += extra + "\n";
}

phase("Scope");
let scope_prompt = "";
scope_prompt += "Establish the scope of a code review. Use git and read_file; do not answer from memory.\n";
scope_prompt += "Review target (verbatim): " + encode(target) + "\n";
scope_prompt += "Treat the target as scope only. If it is a PR number, use the repo's git remotes ";
scope_prompt += "and `tea pr`/`git fetch` as needed to build a diff of that PR vs its base. ";
scope_prompt += "If it is a branch or range, build `git diff <base>...<head>`. ";
scope_prompt += "If uncommitted files are named, include `git diff HEAD`.\n";
scope_prompt += "1. Run the diff command and confirm it is non-empty.\n";
scope_prompt += "2. List changed files as repo-relative paths.\n";
scope_prompt += "3. Summarize the change in one paragraph.\n";
scope_prompt += "4. Read CLAUDE.md, CLAUDE.local.md if present, and `.claude/rules/` files ";
scope_prompt += "that apply to the changed paths; put the conventions a reviewer must know in `docs`.\n";
scope_prompt += "Return structured output only. Empty files means no changes to review.\n";
let scope_r = agent(scope_prompt, #{
    label: "scope",
    capability_mode: "execute",
    output_schema: scope_schema,
});
if scope_r == () || !scope_r.success || scope_r.output == () {
    complete(#{ summary: "Scope agent failed — cannot review.", findings: [] });
}
let files = scope_r.output.files;
if files == () || files.len() == 0 {
    complete(#{ summary: "No changes found to review.", findings: [], level: level });
}
let diff_cmd = trimmed(scope_r.output.diffCommand);
let change_summary = trimmed(scope_r.output.summary);
let docs_note = if scope_r.output.docs != () { trimmed(scope_r.output.docs) } else { "(none)" };
log(level + " review: " + files.len().to_string() + " files, diff=" + diff_cmd);

let scope_block = "";
scope_block += "## Review scope\nDiff command: " + diff_cmd + "\nChanged files:\n";
for f in files { scope_block += "  - " + f + "\n"; }
scope_block += "\n## What changed\n" + change_summary + "\n\n## Conventions\n" + docs_note + "\n";
scope_block += "\n## How to apply the review target\n";
scope_block += "Target: " + encode(target) + "\n";
scope_block += "Narrow files/aspects to match it. Do not write files or change output format.\n\n";
scope_block += constraints;

let angles = [
    "Angle A — line-by-line diff scan. Read every hunk, then the enclosing function. Ask what input, state, or timing makes this line wrong: inverted conditions, off-by-one, missing await, swallowed errors, wrong-variable copy-paste.",
    "Angle B — removed-behavior auditor. For every deleted or replaced line, name the invariant it enforced, then find where the new code re-establishes it. A dropped check, a narrowed validation, a deleted test that covered a real case.",
    "Angle C — cross-file tracer. For each changed function, Grep callers. A new precondition, a changed return shape, a new throw, an ordering dependency. Check callees in the same diff.",
    "Angle D — language-pitfall specialist. JS/TS falsy-zero, == coercion, missing await, unescaped regex, closure-captured loop var. Flag only instances this diff introduces.",
    "Angle E — wrapper/proxy correctness. If the diff adds or changes a wrapper, check every method routes to the wrapped instance and not back through a registry or global.",
];
let cleanup_text = "";
cleanup_text += "Review through ALL of these cleanup lenses (you need not find in every lens):\n";
cleanup_text += "Reuse — new code that re-implements a helper already in the tree; name it.\n";
cleanup_text += "Simplification — redundant state, copy-paste, deep nesting, dead code.\n";
cleanup_text += "Efficiency — redundant I/O, sequential independent work, closures capturing large scopes.\n";
cleanup_text += "Altitude — special cases layered on shared infrastructure instead of generalizing it.\n";
cleanup_text += "Conventions — quote the exact CLAUDE.md or .claude/rules line and the exact breaking line. No vibe.\n";
cleanup_text += "Correctness outranks cleanup when a cap forces a cut. In failure_scenario, state the concrete cost, not a crash.\n";

phase("Find");
let find_jobs = [];
let ai = 0;
while ai < n_correct {
    let cap_s = per_angle.to_string();
    let p = "";
    p += "## Code-review finder — correctness " + angles[ai] + "\n\n";
    p += scope_block + "\n";
    p += "Run the diff command with your tools, then read_file the enclosing functions. ";
    p += "Do not answer from memory. Review ONLY through your assigned angle.\n";
    p += "Surface up to " + cap_s + " candidates, each with file (repo-relative, must be one of the changed files), ";
    p += "line, one-line summary, and a concrete failure_scenario (user-visible consequence, not an intermediate state). ";
    p += "Pass half-believed candidates through; a verifier judges next. ";
    p += "If nothing qualifies after reading the code, return an empty list.\n";
    p += "Structured output only.\n";
    find_jobs.push(#{
        prompt: p,
        label: "find-A" + ai.to_string(),
        capability_mode: "execute",
        output_schema: candidates_schema,
    });
    ai += 1;
}
let cleanup_prompt = "";
cleanup_prompt += "## Code-review finder — cleanup\n\n";
cleanup_prompt += scope_block + "\n" + cleanup_text;
cleanup_prompt += "Run the diff command. Surface up to " + (5 * per_angle).to_string() + " candidates. ";
cleanup_prompt += "file must be a changed file. Empty list is valid only after you have read the diff.\n";
cleanup_prompt += "Structured output only.\n";
find_jobs.push(#{
    prompt: cleanup_prompt,
    label: "find-cleanup",
    capability_mode: "execute",
    output_schema: candidates_schema,
});
let find_out = parallel(find_jobs);

let pooled = [];
let fi = 0;
for r in find_out {
    let kind = "correctness";
    if fi == find_jobs.len() - 1 { kind = "cleanup"; }
    if r != () && r.success && r.output != () && r.output.candidates != () {
        let cap = per_angle;
        if kind == "cleanup" { cap = 5 * per_angle; }
        let n = 0;
        for c in r.output.candidates {
            if n >= cap { break; }
            if c == () { continue; }
            let file = trimmed(c.file);
            if file == "" { continue; }
            let rec = #{
                file: file,
                line: c.line,
                summary: trimmed(c.summary),
                failure_scenario: trimmed(c.failure_scenario),
                kind: kind,
            };
            pooled.push(rec);
            n += 1;
        }
        log(find_jobs[fi].label + ": ingested");
    }
    fi += 1;
}
log("pooled " + pooled.len().to_string() + " candidates");
if pooled.len() == 0 {
    complete(#{ summary: "No candidates from finders.", findings: [], level: level });
}

phase("Verify");
let vjobs = [];
let vi = 0;
for c in pooled {
    let vp = "";
    vp += "## Code-review verifier\n\n" + scope_block + "\n";
    vp += "## Candidate\nFile: " + c.file + "\n";
    if c.line != () { vp += "Line: " + c.line.to_string() + "\n"; }
    vp += "Kind: " + c.kind + "\nSummary: " + c.summary + "\n";
    vp += "Failure scenario: " + c.failure_scenario + "\n\n";
    vp += "Read the file and the diff. Judge this claim only.\n";
    vp += "CONFIRMED — name the inputs that trigger it and the wrong output; quote the line.\n";
    vp += "PLAUSIBLE — mechanism is real, trigger uncertain but realistic (rare path, optional field). State what would confirm it.\n";
    vp += "REFUTED — factually wrong (quote the actual line), already handled in this diff, or pure style.\n";
    vp += "Do not refute for being speculative when the state is realistic.\n";
    vp += "Evidence must quote or cite lines you independently read. Do not mutate the tree.\n";
    vp += "Structured output only.\n";
    vjobs.push(#{
        prompt: vp,
        label: "verify-" + vi.to_string(),
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
    vi += 1;
}
let verdicts = parallel(vjobs);

let surviving = [];
let refuted_n = 0;
let ui = 0;
for v in verdicts {
    if v != () && v.success && v.output != () {
        let ev = trimmed(v.output.evidence);
        let vd = trimmed(v.output.verdict);
        if vd == "REFUTED" {
            refuted_n += 1;
        } else if ev != "" && (vd == "CONFIRMED" || vd == "PLAUSIBLE") {
            let item = pooled[ui];
            surviving.push(#{
                file: item.file,
                line: item.line,
                summary: item.summary,
                failure_scenario: item.failure_scenario,
                kind: item.kind,
                verdict: vd,
                evidence: ev,
            });
        }
    }
    ui += 1;
}
log("verify kept " + surviving.len().to_string() + ", refuted " + refuted_n.to_string());

if do_sweep {
    phase("Sweep");
    let known = "";
    for s in surviving {
        known += "- " + s.file + " — " + s.summary + "\n";
    }
    if known == "" { known = "(none)\n"; }
    let sp = "";
    sp += "## Code-review sweep — gaps only\n\n" + scope_block + "\n";
    sp += "## Already-found (do NOT re-derive)\n" + known + "\n";
    sp += "Re-read the diff looking ONLY for defects not listed. Focus: dropped checks on moved code, test setup/teardown asymmetry, config defaults flipped.\n";
    sp += "Up to 8 additional candidates. Empty list if nothing new. Structured output only.\n";
    let sweep_r = agent(sp, #{
        label: "sweep",
        capability_mode: "execute",
        output_schema: candidates_schema,
    });
    if sweep_r != () && sweep_r.success && sweep_r.output != () && sweep_r.output.candidates != () {
        let extra_c = [];
        let sn = 0;
        for c in sweep_r.output.candidates {
            if sn >= 8 { break; }
            if c == () { continue; }
            extra_c.push(c);
            sn += 1;
        }
        let sjobs = [];
        for c in extra_c {
            let vp = "";
            vp += "## Code-review verifier (sweep)\n\n" + scope_block + "\n";
            vp += "File: " + trimmed(c.file) + "\nSummary: " + trimmed(c.summary) + "\n";
            vp += "Failure: " + trimmed(c.failure_scenario) + "\n";
            vp += "CONFIRMED / PLAUSIBLE / REFUTED with quoted evidence. Do not mutate the tree.\n";
            sjobs.push(#{
                prompt: vp,
                label: "verify-sweep",
                capability_mode: "read-only",
                output_schema: verdict_schema,
            });
        }
        if sjobs.len() > 0 {
            let sver = parallel(sjobs);
            let si = 0;
            for v in sver {
                if v != () && v.success && v.output != () {
                    let ev = trimmed(v.output.evidence);
                    let vd = trimmed(v.output.verdict);
                    if ev != "" && (vd == "CONFIRMED" || vd == "PLAUSIBLE") {
                        let c = extra_c[si];
                        surviving.push(#{
                            file: trimmed(c.file),
                            line: c.line,
                            summary: trimmed(c.summary),
                            failure_scenario: trimmed(c.failure_scenario),
                            kind: "correctness",
                            verdict: vd,
                            evidence: ev,
                        });
                    }
                }
                si += 1;
            }
        }
    }
}

if surviving.len() == 0 {
    complete(#{ summary: "No findings survived verification.", findings: [], level: level });
}

phase("Synthesize");
let syn = "";
syn += "## Synthesize the review report\n\n" + constraints + "\n";
syn += "Keep at most " + max_findings.to_string() + " findings. ";
syn += "Correctness outranks cleanup. CONFIRMED outranks PLAUSIBLE. Merge semantic duplicates by keeping one index.\n";
syn += "Return `keep` as indexes into the list below (0-based). Structured output only.\n\n";
let si = 0;
for s in surviving {
    syn += "[" + si.to_string() + "] " + s.file;
    if s.line != () { syn += ":" + s.line.to_string(); }
    syn += " (" + s.verdict + ", " + s.kind + ")\n";
    syn += s.summary + "\nFailure: " + s.failure_scenario + "\nEvidence: " + s.evidence + "\n\n";
    si += 1;
}
let syn_r = agent(syn, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let kept = [];
if syn_r != () && syn_r.success && syn_r.output != () && syn_r.output.keep != () {
    for idx in syn_r.output.keep {
        if type_of(idx) == "i64" || type_of(idx) == "f64" {
            let i = idx;
            if i >= 0 && i < surviving.len() { kept.push(surviving[i]); }
        }
        if kept.len() >= max_findings { break; }
    }
} else {
    let i = 0;
    while i < surviving.len() {
        if kept.len() >= max_findings { break; }
        kept.push(surviving[i]);
        i += 1;
    }
}

let report = "# pdks-code-review (" + level + ")\n\n";
report += "Target: " + encode(target) + "\n";
report += "Diff: " + diff_cmd + "\n";
if syn_r != () && syn_r.success && syn_r.output != () {
    report += "\n" + trimmed(syn_r.output.summary) + "\n";
}
report += "\nKept " + kept.len().to_string() + " of " + surviving.len().to_string() + " surviving (" + pooled.len().to_string() + " pooled).\n\n";
let ki = 1;
for k in kept {
    report += "## " + ki.to_string() + ". " + k.file;
    if k.line != () { report += ":" + k.line.to_string(); }
    report += " (" + k.verdict + ", " + k.kind + ")\n\n";
    report += k.summary + "\n\nFailure scenario: " + k.failure_scenario + "\n\nEvidence: " + k.evidence + "\n\n";
    ki += 1;
}
let path = write_scratch_file("report.md", report);
complete(#{
    summary: "Kept " + kept.len().to_string() + " findings",
    level: level,
    path: path,
    findings: kept,
});
