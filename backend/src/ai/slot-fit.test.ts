import { describe, expect, it } from "vitest";
import { lastBookableStartMins } from "./slot-fit.js";

const nine = 9 * 60;
const eighteen = 18 * 60;

describe("last bookable start", () => {
  it("offers 17h on a day that closes at 18h when the combo is 50 minutes", () => {
    expect(
      lastBookableStartMins({
        durationMins: 50,
        windowStart: nine,
        windowEnd: eighteen,
        minStart: null,
        busy: [],
        bufferMins: 15,
      }),
    ).toBe(17 * 60);
  });

  it("steps back when 17h collides with the buffer of an 18h appointment", () => {
    expect(
      lastBookableStartMins({
        durationMins: 50,
        windowStart: nine,
        windowEnd: eighteen,
        minStart: null,
        busy: [{ start: 18 * 60, end: 18 * 60 + 30 }],
        bufferMins: 15,
      }),
    ).toBe(16 * 60 + 30);
  });
});
