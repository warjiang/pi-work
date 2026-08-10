import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TestCase } from "vitest/node";
import type { Reporter } from "vitest/reporters";

const tapePath = resolve(".evidence/tape.jsonl");

export default class TapeReporter implements Reporter {
  onInit(): void {
    rmSync(tapePath, { force: true });
    mkdirSync(dirname(tapePath), { recursive: true });
  }

  onTestCaseResult(testCase: TestCase): void {
    appendFileSync(tapePath, `${JSON.stringify({
      id: testCase.id,
      name: testCase.fullName,
      state: testCase.result()?.state,
    })}\n`);
  }
}
