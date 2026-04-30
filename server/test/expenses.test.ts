import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "expense-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");

const { buildApp } = await import("../src/app.js");
const supertest = (await import("supertest")).default;
const app = buildApp();

after(() => rmSync(tmpDir, { recursive: true, force: true }));

const validBody = {
  amount: "199.50",
  category: "Food",
  description: "Lunch",
  date: "2026-04-30",
};

describe("POST /api/expenses", () => {
  it("creates an expense and converts amount to paise", async () => {
    const res = await supertest(app).post("/api/expenses").send(validBody);
    assert.equal(res.status, 201);
    assert.equal(res.body.amount_paise, 19950);
    assert.equal(res.body.currency, "INR");
    assert.equal(typeof res.body.id, "number");
    assert.equal(typeof res.body.created_at, "string");
  });

  it("rejects negative amounts", async () => {
    const res = await supertest(app)
      .post("/api/expenses")
      .send({ ...validBody, amount: "-10.00" });
    assert.equal(res.status, 400);
  });

  it("rejects amounts with more than 2 decimal places", async () => {
    const res = await supertest(app)
      .post("/api/expenses")
      .send({ ...validBody, amount: "10.123" });
    assert.equal(res.status, 400);
  });

  it("rejects missing date", async () => {
    const { date: _omit, ...rest } = validBody;
    const res = await supertest(app).post("/api/expenses").send(rest);
    assert.equal(res.status, 400);
  });

  it("rejects malformed date", async () => {
    const res = await supertest(app)
      .post("/api/expenses")
      .send({ ...validBody, date: "30-04-2026" });
    assert.equal(res.status, 400);
  });

  it("returns the same expense on retry with the same Idempotency-Key", async () => {
    const key = "idem-" + Math.random().toString(36).slice(2);
    const a = await supertest(app)
      .post("/api/expenses")
      .set("Idempotency-Key", key)
      .send(validBody);
    assert.equal(a.status, 201);

    const b = await supertest(app)
      .post("/api/expenses")
      .set("Idempotency-Key", key)
      .send(validBody);
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
  });

  it("returns 409 when an Idempotency-Key is reused with a different body", async () => {
    const key = "idem-" + Math.random().toString(36).slice(2);
    await supertest(app)
      .post("/api/expenses")
      .set("Idempotency-Key", key)
      .send(validBody);
    const res = await supertest(app)
      .post("/api/expenses")
      .set("Idempotency-Key", key)
      .send({ ...validBody, amount: "999.00" });
    assert.equal(res.status, 409);
  });
});

describe("GET /api/expenses", () => {
  before(async () => {
    await supertest(app).post("/api/expenses").send({
      amount: "100.00",
      category: "Travel",
      description: "Bus",
      date: "2026-04-01",
    });
    await supertest(app).post("/api/expenses").send({
      amount: "200.00",
      category: "Travel",
      description: "Cab",
      date: "2026-04-15",
    });
    await supertest(app).post("/api/expenses").send({
      amount: "50.00",
      category: "Food",
      description: "Snack",
      date: "2026-04-20",
    });
  });

  it("filters by category and sorts newest first by default", async () => {
    const res = await supertest(app)
      .get("/api/expenses")
      .query({ category: "Travel", sort: "date_desc" });
    assert.equal(res.status, 200);
    assert.ok(
      res.body.items.every((x: { category: string }) => x.category === "Travel"),
    );
    const dates: string[] = res.body.items.map((x: { date: string }) => x.date);
    const sorted = [...dates].sort().reverse();
    assert.deepEqual(dates, sorted);
    assert.equal(
      res.body.total_paise,
      res.body.items.reduce(
        (s: number, x: { amount_paise: number }) => s + x.amount_paise,
        0,
      ),
    );
  });

  it("returns all expenses with no filter", async () => {
    const res = await supertest(app).get("/api/expenses");
    assert.equal(res.status, 200);
    assert.ok(res.body.count >= 3);
  });
});
