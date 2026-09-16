import test from "node:test";
import assert from "node:assert/strict";
import { firstLine, groupMessageEntries, initials, splitReplyBody, todayISO } from "./format.js";

test("initials uses up to two words", () => {
  assert.equal(initials("Сергей Зырянов"), "СЗ");
  assert.equal(initials("Sergey"), "S");
});

test("groupMessageEntries groups close messages from one author", () => {
  const entries = groupMessageEntries([
    { authorId: "a", createdAt: "2026-09-15T10:00:00Z" },
    { authorId: "a", createdAt: "2026-09-15T10:02:00Z" },
    { authorId: "b", createdAt: "2026-09-15T10:03:00Z" },
  ]);
  assert.deepEqual(entries.map(({ continued, startsDay }) => [continued, startsDay]), [[false, true], [true, false], [false, false]]);
});

test("todayISO uses local calendar date", () => {
  assert.equal(todayISO(new Date(2026, 8, 5, 23, 30)), "2026-09-05");
});

test("firstLine keeps only the first line", () => {
  assert.equal(firstLine("Первая строка\nВторая строка"), "Первая строка");
});

test("splitReplyBody separates quote metadata from message", () => {
  assert.deepEqual(splitReplyBody("↩ Сергей: что делаем дальше?\nСделаем клиента"), {
    reply: { author: "Сергей", text: "что делаем дальше?" },
    body: "Сделаем клиента",
  });
});
