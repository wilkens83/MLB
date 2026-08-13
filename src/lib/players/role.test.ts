import { describe, it, expect } from "bun:test";
import { classifyPitcherRole, classifyHitterRole } from "./role";

describe("classifyPitcherRole", () => {
  it("a rostered pitcher who is NOT today's probable starter is RELIEF — start model does not apply", () => {
    const r = classifyPitcherRole({ playerId: 111, ownProbablePitcherId: 222 });
    expect(r.role).toBe("RELIEF_PITCHER");
    expect(r.isStarter).toBe(false);
    expect(r.startModelApplies).toBe(false);
  });

  it("the posted probable starter matching the player is STARTING_PITCHER", () => {
    const probable = classifyPitcherRole({ playerId: 111, ownProbablePitcherId: 111, starterConfirmed: false });
    expect(probable.role).toBe("STARTING_PITCHER");
    expect(probable.confidence).toBe("probable");
    const confirmed = classifyPitcherRole({ playerId: 111, ownProbablePitcherId: 111, starterConfirmed: true });
    expect(confirmed.confidence).toBe("confirmed");
    expect(confirmed.isStarter).toBe(true);
    expect(confirmed.startModelApplies).toBe(true);
  });

  it("no probable posted → UNKNOWN role, start ASSUMED and labeled (never silently 'confirmed')", () => {
    const r = classifyPitcherRole({ playerId: 111 });
    expect(r.role).toBe("UNKNOWN_PITCHER_ROLE");
    expect(r.confidence).toBe("assumed");
    expect(r.startModelApplies).toBe(true);
    expect(r.note.toLowerCase()).toContain("assumption");
  });

  it("no game resolved → UNKNOWN with confidence none", () => {
    const r = classifyPitcherRole({ playerId: 111, noGameResolved: true });
    expect(r.role).toBe("UNKNOWN_PITCHER_ROLE");
    expect(r.confidence).toBe("none");
  });
});

describe("classifyHitterRole", () => {
  it("in the lineup → STARTING_HITTER; confirmed flag raises confidence", () => {
    expect(classifyHitterRole({ inLineup: true }).role).toBe("STARTING_HITTER");
    expect(classifyHitterRole({ inLineup: true, lineupConfirmed: true }).confidence).toBe("confirmed");
    expect(classifyHitterRole({ inLineup: true }).confidence).toBe("probable");
  });

  it("explicitly out of the lineup → BENCH, start model does not apply", () => {
    const r = classifyHitterRole({ inLineup: false });
    expect(r.role).toBe("BENCH");
    expect(r.startModelApplies).toBe(false);
  });

  it("lineup unknown → UNKNOWN, never silently asserts 'starting'", () => {
    const r = classifyHitterRole({});
    expect(r.role).toBe("UNKNOWN_HITTER_ROLE");
    expect(r.confidence).toBe("assumed");
    expect(r.note.toLowerCase()).toContain("assumption");
  });
});
