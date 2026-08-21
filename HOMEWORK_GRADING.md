# Homework grading

Physics Hub grades multiple-choice homework in PostgreSQL, not in the browser.

## Flow

1. Admin stores questions/keys in `assignments.questions` or lesson homework fields.
2. Students read `homework_catalog`/`lesson_catalog`, which remove answer-key properties.
3. Answers are posted to `grade_assignment_submission()` or `grade_lesson_homework()`.
4. The RPC validates identity, eligibility, payload size, file path, and attempt status.
5. `ph_mark_answers()` normalizes Arabic/Latin letters, digits, option labels, and short text.
6. Weighted score/count/percentage/breakdown are stored under the grading-trigger bypass scoped to that transaction.
7. A graded assignment cannot be overwritten by the student.
8. The explanation URL is returned only after that student's assignment is graded.

Configured production mode does not fall back to client-computed scores. If the RPC is missing, submission fails with an instruction to apply `homework-grading.sql`.

## Question format

```json
{
  "id": "q1",
  "question": "SI unit of current?",
  "options": ["A) Ampere", "B) Volt", "C) Ohm", "D) Joule"],
  "answer": "A",
  "points": 5
}
```

Accepted key/answer representations include `A`–`F`, Arabic option letters, 0/1-based numeric indexes, prefixed labels, or matching option text. Missing keys are not awarded points.

## Regrading

Administrators use `regrade_assignment(uuid)` or `regrade_lesson_homework(uuid)`. The UI calls one set-based RPC rather than one write per student.

## Apply and test

```text
schema.sql
homework-grading.sql
bulk-messaging.sql
```

Then run `npm run test:grading` locally and the live homework/RLS checks in `docs/OPERATIONS.md`.
