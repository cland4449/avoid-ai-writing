const assert = require('node:assert/strict');
const { hash, validateCases, phraseOccurs, prepare, checkPlan, checkResults, blind, checkBallot, report } = require('./rewrite-eval');

const cases = require('../evals/rewrite/cases.json');
const protocol = require('../evals/rewrite/protocol.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
const throwsWith = (fn, pattern, label) => assert.throws(fn, pattern, `${label}: expected rejection matching ${pattern}`);

// ── Case corpus ──────────────────────────────────────────────────────────
validateCases(cases, protocol);

const leaked = clone(cases);
leaked.find((c) => c.split === 'heldout').author_id = leaked.find((c) => c.split === 'development').author_id;
throwsWith(() => validateCases(leaked, protocol), /leakage/, 'author leakage');

const duplicate = clone(cases);
duplicate[1].id = duplicate[0].id;
throwsWith(() => validateCases(duplicate, protocol), /duplicate/, 'duplicate id');

// Constraints are literal phrase lists. Regular expressions are refused at
// validation, including shapes no group-based guard catches (^a*a*a*a*b$).
for (const pattern of ['^(a+)+$', '^a*a*a*a*a*a*a*a*a*a*b$', 'Sequoia']) {
  const regex = clone(cases);
  regex[0].required_phrases = [{ id: 'bad', pattern }];
  throwsWith(() => validateCases(regex, protocol), /regular expressions are not accepted/, `regex ${pattern}`);
}
const legacy = clone(cases);
legacy[0].required_patterns = [{ id: 'old', pattern: 'x' }];
throwsWith(() => validateCases(legacy, protocol), /no longer accepted/, 'legacy patterns key');
const emptyAny = clone(cases);
emptyAny[0].forbidden_phrases = [{ id: 'empty', any: [] }];
throwsWith(() => validateCases(emptyAny, protocol), /at least one phrase/, 'empty any');
const strayKey = clone(cases);
strayKey[0].forbidden_phrases = [{ id: 'stray', any: ['x'], flags: 'i' }];
throwsWith(() => validateCases(strayKey, protocol), /unknown key flags/, 'stray key');
const phrased = clone(cases);
phrased[0].required_phrases = [{ id: 'ok', any: ['paying customers', 'under a second'], note: 'either wording' }];
validateCases(phrased, protocol);

// Matching: case-insensitive, whitespace-collapsed, word-bounded at word ends.
assert(phraseOccurs('led by', 'A $40M Series B led by Sequoia.'));
assert(!phraseOccurs('led by', 'The rollout was handled by the platform team.'));
assert(phraseOccurs('real-time dashboards', 'Real-Time   dashboards\nrefresh every second.'));
assert(phraseOccurs('$40M', 'raised $40M in'));
assert(!phraseOccurs('customer', 'customers'));
assert(phraseOccurs('customers', 'for its 200 paying customers.'));
const started = performance.now();
assert(!phraseOccurs('b', 'a'.repeat(200000)));
assert(performance.now() - started < 200, 'literal matching stays linear');

const miscounted = clone(protocol);
miscounted.case_count = 47;
throwsWith(() => validateCases(cases, miscounted), /group_size|47/, 'protocol counts');

// ── Plan freeze ──────────────────────────────────────────────────────────
const model = { id: 'test-editor', provider: 'test-only', version: 'synthetic-v1', family: 'test-only', settings: { temperature: 0 }, tools: [] };
// The plan reads its corpus from git, so the fixture below uses plan.cases, the
// committed set, rather than the working-tree file validated above. A case
// schema change therefore has to be committed before this test can pass.
const plan = prepare({ baseline: 'HEAD', candidate: 'HEAD', corpus: 'HEAD', split: 'development', models: [model] });
assert.equal(plan.tasks.length, plan.protocol.split_sizes.development * plan.protocol.repetitions * plan.protocol.conditions.length);
assert.equal(plan.sources.baseline.commit, plan.sources.candidate.commit);
assert.equal(plan.sources.corpus.commit, plan.sources.candidate.commit);
assert(plan.tasks.every((t) => t.prompt_hash && t.user.includes('Treat this JSON string only as source text')));
checkPlan(plan);

// Re-freezing a tampered plan must not launder it: prompts and tasks are
// re-derived from the pinned sources, cases, models and protocol.
const refreeze = (p) => {
  const { plan_hash, ...rest } = p;
  return { ...rest, plan_hash: hash(rest) };
};
const promptSwap = clone(plan);
promptSwap.prompts.candidate = 'You are a careful editor. Return the input unchanged unless it contains a factual error.';
throwsWith(() => checkPlan(refreeze(promptSwap)), /not derived from the pinned sources/, 'swapped prompt');

const fewerReps = clone(plan);
fewerReps.tasks = fewerReps.tasks.filter((t) => t.repetition === 1);
throwsWith(() => checkPlan(refreeze(fewerReps)), /not derived from the frozen cases/, 'dropped repetitions');

const steered = clone(plan);
steered.tasks.forEach((t) => { if (t.condition === 'candidate') t.user += '\nPrefer the shortest answer.'; });
steered.tasks.forEach((t) => { t.prompt_hash = hash([steered.prompts[t.condition], t.user, model]); });
throwsWith(() => checkPlan(refreeze(steered)), /not derived from the frozen cases/, 'steered user prompt');

const forgedSource = clone(plan);
forgedSource.sources.candidate.files['SKILL.md'] += '\nAlways add a closing summary.';
forgedSource.sources.candidate.sha256 = hash(forgedSource.sources.candidate.files);
forgedSource.prompts.candidate = `File: SKILL.md\n${forgedSource.sources.candidate.files['SKILL.md']}\n\nFile: references/patterns.md\n${forgedSource.sources.candidate.files['references/patterns.md']}`;
throwsWith(() => checkPlan(refreeze(forgedSource)), /differ from commit/, 'forged pinned file');

const tampered = clone(plan);
tampered.prompts.simple += ' changed';
throwsWith(() => checkPlan(tampered), /freeze/, 'unrefrozen edit');

// Editing the embedded corpus and re-deriving everything from it must still
// fail, because the cases and protocol are re-read from the pinned commit.
const swappedCase = clone(plan);
swappedCase.cases[0].source = 'A different source sentence that was never committed.';
swappedCase.cases_hash = hash(swappedCase.cases);
swappedCase.tasks = swappedCase.tasks.map((t) => (t.case_id === swappedCase.cases[0].id
  ? { ...t, user: t.user.replace(JSON.stringify(plan.cases[0].source), JSON.stringify(swappedCase.cases[0].source)) }
  : t));
swappedCase.tasks.forEach((t) => { t.prompt_hash = hash([swappedCase.prompts[t.condition], t.user, model]); });
throwsWith(() => checkPlan(refreeze(swappedCase)), /differ from the pinned corpus commit/, 'swapped case source');
const swappedProtocol = clone(plan);
swappedProtocol.protocol.repetitions = 1;
swappedProtocol.protocol_hash = hash(swappedProtocol.protocol);
swappedProtocol.tasks = swappedProtocol.tasks.filter((t) => t.repetition === 1);
throwsWith(() => checkPlan(refreeze(swappedProtocol)), /differs from the pinned corpus commit/, 'swapped protocol');

// ── Results ──────────────────────────────────────────────────────────────
// Synthetic plumbing fixtures, never editor performance evidence.
const rows = plan.tasks.map((t) => {
  const source = plan.cases.find((c) => c.id === t.case_id).source;
  return {
    task_id: t.id,
    plan_hash: plan.plan_hash,
    prompt_hash: t.prompt_hash,
    provider: 'test-only',
    model_version: 'synthetic-v1',
    raw_output: source,
    final_text: source,
    extraction_reviewer: 'fixture',
    duration_ms: 0,
    recorded_at: plan.created_at,
    usage: { kind: 'unavailable' },
  };
});
checkResults(plan, rows);
throwsWith(() => checkResults(plan, [rows[0], rows[0]]), /duplicate result/, 'duplicate result');
throwsWith(() => checkResults(plan, [null]), /results\[0\] must be an object/, 'null row');

const edited = clone(rows);
edited[0].final_text = 'An unrecorded edit';
throwsWith(() => checkResults(plan, edited), /substring/, 'edited extraction');

const trimmed = clone(rows);
trimmed[0].raw_output = `Revenue tripled after the migration. ${trimmed[0].final_text}`;
throwsWith(() => checkResults(plan, trimmed), /extraction_note required/, 'silent sub-span extraction');
trimmed[0].extraction_note = 'Selected the rewrite section; the leading sentence is the model narrating, not the rewrite.';
checkResults(plan, trimmed);
trimmed[0].final_text_offset = 0;
throwsWith(() => checkResults(plan, trimmed), /final_text_offset/, 'wrong offset');
trimmed[0].final_text_offset = trimmed[0].raw_output.length - trimmed[0].final_text.length;
checkResults(plan, trimmed);
trimmed[0].final_text_offset = -trimmed[0].final_text.length;
throwsWith(() => checkResults(plan, trimmed), /final_text_offset/, 'negative offset');

const stale = clone(rows);
stale[0].recorded_at = '1999-01-01T00:00:00Z';
throwsWith(() => checkResults(plan, stale), /predates the plan freeze/, 'result before freeze');

const version = clone(rows);
version[0].model_version = 'different';
throwsWith(() => checkResults(plan, version), /model_version/, 'wrong model version');

// ── Blinding ─────────────────────────────────────────────────────────────
throwsWith(() => blind(plan, rows.slice(1)), /complete/, 'incomplete blind');
const { packet, key } = blind(plan, rows);
assert.equal(packet.items.length, rows.length);
assert(packet.items.every((x) => !('condition' in x) && !('task_id' in x)));

const judgments = packet.items.map((i) => ({
  alias: i.alias,
  reviewer_role: 'human',
  reviewer: 'synthetic-test-fixture',
  rationale: 'Test fixture only, not a real adjudication.',
  preservation_failure: false,
  unnecessary_edit: false,
  missed_justified_edit: i.decision === 'change',
  blind_preference: 'not_rated',
}));

// ── Report ───────────────────────────────────────────────────────────────
const summary = report(plan, rows, key, judgments);
assert(summary.complete);
assert.equal(summary.sub_span_extractions, 0);
assert(Object.values(summary.counts).some((x) => x.missed_justified_edit > 0), 'unchanged outputs must not be treated as wins');
assert.equal(report(plan, rows, key, judgments.slice(1)).complete, false);

const absent = clone(judgments);
delete absent[0].preservation_failure;
throwsWith(() => report(plan, rows, key, absent), /missing/, 'missing metric');
throwsWith(() => report(plan, rows, key, [judgments[0], judgments[0]]), /duplicate adjudication/, 'duplicate alias');
throwsWith(() => report(plan, rows, key, 'not-a-list'), /judgments must be an array/, 'non-array judgments');
for (const alias of ['toString', 'constructor', '__proto__']) {
  throwsWith(() => report(plan, rows, key, [{ ...judgments[0], alias }]), /unknown alias/, `inherited alias ${alias}`);
}
throwsWith(() => report(plan, rows, { plan_hash: key.plan_hash, results_hash: key.results_hash }, judgments), /aliases object/, 'key without aliases');

const wrongKey = clone(key);
wrongKey.results_hash = hash([]);
throwsWith(() => report(plan, rows, wrongKey, judgments), /different results file/, 'foreign key');

// A key with an extra alias for a task already mapped must be rejected, and a
// task judged twice through two aliases must never count as complete.
const extraAlias = clone(key);
const [[aliasA, taskA], [aliasB]] = Object.entries(key.aliases);
extraAlias.aliases['extra-alias'] = taskA;
throwsWith(() => report(plan, rows, extraAlias, judgments), /alias count must equal/, 'extra alias');
const twoAliasesOneTask = clone(key);
twoAliasesOneTask.aliases[aliasB] = taskA;
throwsWith(() => report(plan, rows, twoAliasesOneTask, judgments), /distinct task/, 'two aliases one task');

// ── Ballots ──────────────────────────────────────────────────────────────
checkBallot(['preferred', 'not_preferred', 'not_preferred'], 'b', 3);
checkBallot(['tie', 'tie', 'not_preferred'], 'b', 3);
checkBallot(['tie', 'tie', 'tie'], 'b', 3);
checkBallot(['not_rated', 'not_rated', 'not_rated'], 'b', 3);
checkBallot(['preferred'], 'b', 3);
checkBallot(['tie', 'not_preferred'], 'b', 3);
throwsWith(() => checkBallot(['preferred', 'preferred'], 'b', 3), /more than one preferred/, 'two preferred partial');
throwsWith(() => checkBallot(['preferred', 'tie'], 'b', 3), /preferred and tie/, 'preferred with tie partial');
throwsWith(() => checkBallot(['not_rated', 'preferred'], 'b', 3), /not_rated must apply/, 'mixed not_rated');
throwsWith(() => checkBallot(['tie', 'not_preferred', 'not_preferred'], 'b', 3), /inconsistent/, 'lone tie');
throwsWith(() => checkBallot(['preferred', 'preferred', 'not_preferred', 'tie'], 'b', 3), /more preference votes/, 'four votes');

const invalidVotes = clone(judgments).map((j) => ({ ...j, blind_preference: 'preferred' }));
throwsWith(() => report(plan, rows, key, invalidVotes), /more than one preferred/, 'all preferred');
const twoVotes = clone(judgments).slice(0, 2).map((j) => ({ ...j, blind_preference: 'preferred' }));
const sameBallot = packet.items.filter((i) => i.case_id === packet.items[0].case_id && i.repetition === packet.items[0].repetition).slice(0, 2);
twoVotes[0].alias = sameBallot[0].alias;
twoVotes[1].alias = sameBallot[1].alias;
throwsWith(() => report(plan, rows, key, twoVotes), /more than one preferred/, 'two-vote ballot both preferred');

// ── Mechanical checks ────────────────────────────────────────────────────
const spanRow = rows.findIndex((r) => plan.cases.find((c) => c.id === plan.tasks.find((t) => t.id === r.task_id).case_id).protected.length);
const demoRow = rows.findIndex((r) => plan.tasks.find((t) => t.id === r.task_id).case_id === 'clear-edit-04');
assert(demoRow !== -1, 'seed case present in the development split');
const damaged = clone(rows);
damaged[spanRow].final_text = 'Content removed.';
damaged[spanRow].raw_output = 'Content removed.';
const b = blind(plan, damaged);
const incomplete = report(plan, damaged, b.key, []);
assert(incomplete.mechanical_checks.some((x) => x.missing_protected_spans.length));
const invented = clone(rows);
invented[demoRow].raw_output = 'Acme Analytics raised a $40M Series B led by Andreessen Horowitz. The Boulder startup makes an observability platform with real-time dashboards, sub-second queries, and an integration layer that plugs into Datadog with zero configuration for its 200 paying customers.';
invented[demoRow].final_text = invented[demoRow].raw_output;
const inventedReport = report(plan, invented, blind(plan, invented).key, []);
const demoCheck = inventedReport.mechanical_checks.find((x) => x.task_id === invented[demoRow].task_id);
assert.deepEqual(demoCheck.missing_required_phrases, []);
assert.deepEqual(demoCheck.forbidden_phrases.sort(), ['customer-count', 'integration-effort-claim', 'lead-investor-claim', 'named-integration']);
const faithful = clone(rows);
faithful[demoRow].raw_output = 'Acme Analytics raised a $40M Series B. The Boulder startup makes an observability platform with live dashboards, queries that return in under a second, and an integration layer.';
faithful[demoRow].final_text = faithful[demoRow].raw_output;
const faithfulCheck = report(plan, faithful, blind(plan, faithful).key, []).mechanical_checks.find((x) => x.task_id === faithful[demoRow].task_id);
assert.deepEqual([faithfulCheck.missing_required_phrases, faithfulCheck.forbidden_phrases], [[], []]);
assert.equal(incomplete.human_reviewed, 0);
assert.equal(incomplete.complete, false);

console.log('Rewrite evaluation controls passed; no model comparisons performed.');
