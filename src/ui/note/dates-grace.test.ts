import { describe, expect, it } from "vitest";
import { createTestClock } from "../../sync/testing/test-clock";
import {
  createDatesGrace,
  DATES_GRACE_MS,
  type DatesGraceInput,
  type DetailsForm,
} from "./dates-grace";

const loading = (noteSwitch: number): DatesGraceInput => ({
  noteSwitch,
  notSaved: false,
  hasDates: false,
});
const withDates = (noteSwitch: number): DatesGraceInput => ({
  noteSwitch,
  notSaved: false,
  hasDates: true,
});
const draft = (noteSwitch: number, hasDates = false): DatesGraceInput => ({
  noteSwitch,
  notSaved: true,
  hasDates,
});

function setup() {
  const clock = createTestClock();
  const forms: DetailsForm[] = [];
  const grace = createDatesGrace({ clock, onForm: (f) => forms.push(f) });
  return { clock, forms, grace };
}

describe("createDatesGrace", () => {
  it("shows full details when dates arrive just inside the grace period", () => {
    const { clock, forms, grace } = setup();
    grace.update(loading(1));
    clock.advance(DATES_GRACE_MS - 1);
    grace.update(withDates(1));
    clock.advance(DATES_GRACE_MS);
    expect(forms).toEqual(["pending", "full"]);
  });

  it("falls back to compact details when dates arrive after the grace period", () => {
    const { clock, forms, grace } = setup();
    grace.update(loading(1));
    clock.advance(DATES_GRACE_MS - 1);
    expect(forms).toEqual(["pending"]);
    clock.advance(1);
    expect(forms).toEqual(["pending", "compact"]);
    grace.update(withDates(1));
    expect(forms).toEqual(["pending", "compact", "full"]);
  });

  it("restarts the grace period on a new note switch", () => {
    const { clock, forms, grace } = setup();
    grace.update(loading(1));
    clock.advance(100);
    grace.update(loading(2));
    clock.advance(100);
    expect(forms).toEqual(["pending"]);
    clock.advance(DATES_GRACE_MS - 100);
    expect(forms).toEqual(["pending", "compact"]);
  });

  it("returns to pending on a new switch after full details", () => {
    const { forms, grace } = setup();
    grace.update(withDates(1));
    grace.update(loading(2));
    expect(forms).toEqual(["full", "pending"]);
  });

  it("keeps full details when dates go null within the same switch", () => {
    const { clock, forms, grace } = setup();
    grace.update(loading(1));
    grace.update(withDates(1));
    grace.update(loading(1));
    clock.advance(DATES_GRACE_MS * 2);
    expect(forms).toEqual(["pending", "full"]);
  });

  it("walks a draft through not-saved, grace, compact and full", () => {
    const { clock, forms, grace } = setup();
    grace.update(draft(1));
    grace.update(loading(1));
    clock.advance(DATES_GRACE_MS - 1);
    expect(forms).toEqual(["not-saved"]);
    clock.advance(1);
    expect(forms).toEqual(["not-saved", "compact"]);
    grace.update(withDates(1));
    expect(forms).toEqual(["not-saved", "compact", "full"]);
  });

  it("does not restart the timer on repeated updates while waiting after a draft", () => {
    const { clock, forms, grace } = setup();
    grace.update(draft(1));
    grace.update(loading(1));
    clock.advance(100);
    grace.update(loading(1));
    clock.advance(DATES_GRACE_MS - 100);
    expect(forms).toEqual(["not-saved", "compact"]);
  });

  it("goes straight to full when dates are present as a draft gets saved", () => {
    const { clock, forms, grace } = setup();
    grace.update(draft(1, true));
    grace.update(withDates(1));
    clock.advance(DATES_GRACE_MS * 2);
    expect(forms).toEqual(["not-saved", "full"]);
  });

  it("cancels a running timer when content becomes unsaved", () => {
    const { clock, forms, grace } = setup();
    grace.update(loading(1));
    grace.update(draft(1));
    clock.advance(DATES_GRACE_MS * 2);
    expect(forms).toEqual(["pending", "not-saved"]);
  });

  it("stops the timer on dispose", () => {
    const { clock, forms, grace } = setup();
    grace.update(loading(1));
    grace.dispose();
    clock.advance(DATES_GRACE_MS * 2);
    expect(forms).toEqual(["pending"]);
  });
});
