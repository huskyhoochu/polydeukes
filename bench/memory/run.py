# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow"]
# ///
"""Measure `pdks-memory search` on pinned public retrieval benchmarks.

usage: uv run bench/memory/run.py <pdks-memory executable>

Every task is downloaded from Hugging Face at a fixed revision into bench/memory/.cache/. Each
corpus document becomes one markdown file in a temporary project, titled "-" so its file name does
not take part in title matching, and every query runs as
`pdks-memory search <query> --json --limit 100`. Relevance is binary: every qrels row in these
datasets has no score or a score of 1. The hakari-bench datasets ship their BM25 and dense candidate
rankings; the same metric code scores them, so those columns reproduce each dataset README. The
hakari-bench document pools were built from BM25 hard negatives, so the numbers compare systems on
the same pool, not with full MTEB.

stdout is a markdown table that is identical across runs of the same executable; the elapsed time
goes to stderr.
"""

import concurrent.futures
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")

MTEB_KO = ("hakari-bench/NanoMTEB-Korean", "7cba9121a3231a8f60b41975560f27d105c2ee8c")
MIRACL = ("hakari-bench/NanoMIRACL", "ea97b8cca4e0e0e19910c43e7f3ee9a60fef3a74")
BEIR_EN = ("hakari-bench/NanoBEIR-en", "d3962aa8efe48ed79044c5e155b848982667b4ba")
XPQA = ("mteb/XPQARetrieval", "fc4624be978945a0ceebbc4b85737258fe26330b")
DATASETS = [MTEB_KO, MIRACL, BEIR_EN, XPQA]
BEIR_TASKS = [
    "NanoArguAna", "NanoClimateFEVER", "NanoDBPedia", "NanoFEVER", "NanoFiQA2018", "NanoHotpotQA",
    "NanoMSMARCO", "NanoNFCorpus", "NanoNQ", "NanoQuoraRetrieval", "NanoSCIDOCS", "NanoSciFact",
    "NanoTouche2020",
]


def hakari(dataset, split):
    file = f"{split}-00000-of-00001.parquet"
    return {
        "dataset": dataset, "name": split,
        "corpus": f"corpus/{file}", "queries": f"queries/{file}", "qrels": f"qrels/{file}",
        "bm25": f"bm25/{file}", "dense": f"harrier_oss_v1_270m/{file}",
    }


def xpqa(subset):
    file = "test-00000-of-00001.parquet"
    return {
        "dataset": XPQA, "name": f"xpqa_{subset}",
        "corpus": f"{subset}-corpus/{file}", "queries": f"{subset}-queries/{file}",
        "qrels": f"{subset}-qrels/{file}", "bm25": None, "dense": None,
    }


TASKS = (
    [hakari(MTEB_KO, s) for s in ["autorag", "ko_strategy_qa", "lawir_ko", "miracl_ko", "squad_kor_v1"]]
    + [hakari(MIRACL, "en")]
    + [hakari(BEIR_EN, t) for t in BEIR_TASKS]
    + [xpqa("kor-eng")]  # XPQA names subsets document language first: English queries, Korean documents.
)


def table(dataset, path):
    repo, revision = dataset
    local = os.path.join(CACHE, repo.replace("/", "__"), revision, path)
    if not os.path.exists(local):
        os.makedirs(os.path.dirname(local), exist_ok=True)
        url = f"https://huggingface.co/datasets/{repo}/resolve/{revision}/{path}"
        urllib.request.urlretrieve(url, local + ".part")
        os.replace(local + ".part", local)
    return pq.read_table(local).to_pylist()


def ident(row):
    return row["_id"] if "_id" in row else row["id"]


def qrels(task):
    relevant = {}
    for row in table(task["dataset"], task["qrels"]):
        relevant.setdefault(row["query-id"], set()).add(row["corpus-id"])
    return relevant


def scores(ranked, relevant):
    dcg = sum(1 / math.log2(i + 2) for i, d in enumerate(ranked[:10]) if d in relevant)
    idcg = sum(1 / math.log2(i + 2) for i in range(min(10, len(relevant))))
    first = next((i for i, d in enumerate(ranked[:10]) if d in relevant), None)
    return {
        "ndcg": dcg / idcg,
        "recall": len(set(ranked[:100]) & relevant) / len(relevant),
        "mrr": 0 if first is None else 1 / (first + 1),
        "hit": 0 if first is None else 1,
    }


def mean(rows, key):
    return 100 * sum(r[key] for r in rows) / len(rows)


def candidates(task, kind, relevant):
    runs = {r["query-id"]: r["corpus-ids"] for r in table(task["dataset"], task[kind])}
    return [scores(runs.get(q, []), docs) for q, docs in relevant.items()]


def search(binary, project, query_id, query, task_name):
    run = subprocess.run(
        [binary, "search", query, "--json", "--limit", "100"],
        cwd=project, capture_output=True, text=True,
    )
    if run.returncode != 0:
        sys.stderr.write(f"{task_name} query {query_id}: exit {run.returncode}\n{run.stderr}")
        sys.exit(run.returncode)
    return [hit["conceptId"] for hit in json.loads(run.stdout)["results"]]


def measure(binary, task):
    corpus = table(task["dataset"], task["corpus"])
    queries = {ident(r): r["text"] for r in table(task["dataset"], task["queries"])}
    relevant = qrels(task)
    with tempfile.TemporaryDirectory(prefix="pdks-bench-") as project:
        os.makedirs(os.path.join(project, "docs"))
        doc_ids = {}
        for i, row in enumerate(corpus):
            doc_ids[f"docs/d{i}"] = ident(row)
            with open(os.path.join(project, "docs", f"d{i}.md"), "w", encoding="utf-8") as f:
                f.write(f'---\ntitle: "-"\n---\n{row["text"]}')
        with open(os.path.join(project, "polydeukes.config.yaml"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"memory": {"include": ["docs/**/*.md"]}}))
        with concurrent.futures.ThreadPoolExecutor(os.cpu_count()) as pool:
            hits = pool.map(lambda q: search(binary, project, q, queries[q], task["name"]), relevant)
            ranked = {q: list(dict.fromkeys(doc_ids[c] for c in concepts)) for q, concepts in zip(relevant, hits)}
    own = [scores(ranked[q], docs) for q, docs in relevant.items()]
    row = {
        "task": task["name"], "dataset": task["dataset"], "queries": len(relevant), "docs": len(corpus),
        "ndcg": mean(own, "ndcg"), "recall": mean(own, "recall"),
        "mrr": mean(own, "mrr"), "hit": mean(own, "hit"),
    }
    if task["bm25"]:
        bm25, dense = candidates(task, "bm25", relevant), candidates(task, "dense", relevant)
        row.update(bm25=mean(bm25, "ndcg"), dense=mean(dense, "ndcg"), bm25_recall=mean(bm25, "recall"))
    return row


COLUMNS = [
    ("task", "task"), ("queries", "queries"), ("docs", "docs"), ("nDCG@10", "ndcg"),
    ("R@100", "recall"), ("MRR@10", "mrr"), ("hit@10", "hit"), ("BM25 nDCG@10", "bm25"),
    ("Dense nDCG@10", "dense"), ("BM25 R@100", "bm25_recall"),
]


def line(row):
    cells = []
    for _, key in COLUMNS:
        value = row.get(key)
        cells.append("—" if value is None else f"{value:.2f}" if isinstance(value, float) else str(value))
    return "| " + " | ".join(cells) + " |"


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: uv run bench/memory/run.py <pdks-memory executable>")
    binary = os.path.abspath(sys.argv[1])
    with open(binary, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    started = time.monotonic()
    rows = [measure(binary, task) for task in TASKS]
    print(f"pdks-memory sha256 {digest}")
    for repo, revision in DATASETS:
        print(f"{repo} {revision}")
    print()
    print("| " + " | ".join(h for h, _ in COLUMNS) + " |")
    print("|" + "---|" * len(COLUMNS))
    for dataset in DATASETS:
        members = [r for r in rows if r["dataset"] == dataset]
        for r in members:
            print(line(r))
        if len(members) > 1:
            avg: dict = {"task": f"mean ({dataset[0].split('/')[1]})"}
            for key in ["ndcg", "recall", "mrr", "hit", "bm25", "dense", "bm25_recall"]:
                values = [r[key] for r in members if key in r]
                if len(values) == len(members):
                    avg[key] = sum(values) / len(values)
            print(line(avg))
    sys.stderr.write(f"elapsed {time.monotonic() - started:.0f}s\n")


if __name__ == "__main__":
    main()
