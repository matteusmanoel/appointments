import { describe, expect, it } from "vitest";
import {
  PX_PER_MINUTE_DESKTOP,
  placeBlocks,
  rangeFromSlots,
  snapClickToSlot,
  type AppointmentSpanInput,
} from "./day-timeline";

const RANGE = rangeFromSlots(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);

function apt(partial: Partial<AppointmentSpanInput> & Pick<AppointmentSpanInput, "id">): AppointmentSpanInput {
  return {
    barberId: "b1",
    status: "confirmed",
    scheduledTime: "10:00",
    durationMinutes: 30,
    ...partial,
  };
}

describe("placeBlocks", () => {
  it("desenha um atendimento de 90 min como um único bloco", () => {
    expect(RANGE).not.toBeNull();
    const blocks = placeBlocks({
      appointments: [apt({ id: "long", scheduledTime: "10:00", durationMinutes: 90 })],
      range: RANGE!,
      pxPerMinute: PX_PER_MINUTE_DESKTOP,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("long");
    expect(blocks[0]?.topPx).toBe(60 * PX_PER_MINUTE_DESKTOP);
    expect(blocks[0]?.heightPx).toBe(90 * PX_PER_MINUTE_DESKTOP);
    expect(blocks[0]?.laneCount).toBe(1);
  });

  it("divide a coluna quando dois atendimentos ocupam o mesmo horário", () => {
    const blocks = placeBlocks({
      appointments: [
        apt({ id: "a", scheduledTime: "10:00", durationMinutes: 60 }),
        apt({ id: "b", scheduledTime: "10:00", durationMinutes: 30 }),
      ],
      range: RANGE!,
      pxPerMinute: PX_PER_MINUTE_DESKTOP,
    });
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.lane).sort()).toEqual([0, 1]);
    expect(blocks.every((block) => block.laneCount === 2)).toBe(true);
  });

  it("deixa cancelado e falta fora da grade", () => {
    const blocks = placeBlocks({
      appointments: [
        apt({ id: "ok" }),
        apt({ id: "cancelled", status: "cancelled" }),
        apt({ id: "noshow", status: "no_show", scheduledTime: "11:00" }),
      ],
      range: RANGE!,
      pxPerMinute: PX_PER_MINUTE_DESKTOP,
    });
    expect(blocks.map((block) => block.id)).toEqual(["ok"]);
  });

  it("usa completed_time como fim quando o atendimento já foi concluído", () => {
    const blocks = placeBlocks({
      appointments: [
        apt({
          id: "done",
          status: "completed",
          scheduledTime: "10:00",
          durationMinutes: 60,
          completedTime: "10:20",
        }),
      ],
      range: RANGE!,
      pxPerMinute: 2,
    });
    expect(blocks[0]?.heightPx).toBe(40);
  });
});

describe("snapClickToSlot", () => {
  const slots = ["09:00", "09:30", "10:00", "10:30", "11:00", "13:00"];
  const range = rangeFromSlots(slots)!;

  it("encaixa 10:14 no slot de 10:00", () => {
    const offsetY = (10 * 60 + 14 - range.startMin) * PX_PER_MINUTE_DESKTOP;
    expect(
      snapClickToSlot({
        offsetY,
        range,
        pxPerMinute: PX_PER_MINUTE_DESKTOP,
        slots,
      }),
    ).toBe("10:00");
  });

  it("ignora o clique quando o slot de 30 min está indisponível", () => {
    const offsetY = (12 * 60 + 10 - range.startMin) * PX_PER_MINUTE_DESKTOP;
    expect(
      snapClickToSlot({
        offsetY,
        range,
        pxPerMinute: PX_PER_MINUTE_DESKTOP,
        slots,
      }),
    ).toBeNull();
  });
});
