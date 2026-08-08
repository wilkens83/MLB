import { describe, it, expect } from "bun:test";
import {
  EMPTY_SAVED_STATE,
  isFavorite,
  isFollowing,
  addFavorite,
  removeFavorite,
  addFollow,
  removeFollow,
  setPreferredMetrics,
  markViewed,
  activeFollows,
  favoriteIds,
} from "./saved-players";

const AARON_JUDGE = 592450; // canonical MLBAM id
const SHOHEI = 660271;

describe("favorites (a lightweight bookmark)", () => {
  it("adds a favorite and reports it as favorited", () => {
    const s = addFavorite(EMPTY_SAVED_STATE, AARON_JUDGE, "2026-08-08T00:00:00Z");
    expect(isFavorite(s, AARON_JUDGE)).toBe(true);
    expect(favoriteIds(s)).toEqual([AARON_JUDGE]);
  });

  it("never creates a duplicate favorite row for the same player", () => {
    let s = addFavorite(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = addFavorite(s, AARON_JUDGE);
    s = addFavorite(s, AARON_JUDGE);
    expect(s.favorites.length).toBe(1);
  });

  it("removing a favorite clears it", () => {
    let s = addFavorite(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = removeFavorite(s, AARON_JUDGE);
    expect(isFavorite(s, AARON_JUDGE)).toBe(false);
    expect(s.favorites.length).toBe(0);
  });

  it("uses the canonical player id as identity (a number, not a name)", () => {
    const s = addFavorite(EMPTY_SAVED_STATE, AARON_JUDGE);
    expect(typeof s.favorites[0].playerId).toBe("number");
    expect(s.favorites[0].playerId).toBe(AARON_JUDGE);
  });
});

describe("following (opt-in performance tracking) is separate from favoriting", () => {
  it("following a player does NOT favorite them, and vice versa", () => {
    const followed = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE);
    expect(isFollowing(followed, AARON_JUDGE)).toBe(true);
    expect(isFavorite(followed, AARON_JUDGE)).toBe(false);

    const favorited = addFavorite(EMPTY_SAVED_STATE, AARON_JUDGE);
    expect(isFavorite(favorited, AARON_JUDGE)).toBe(true);
    expect(isFollowing(favorited, AARON_JUDGE)).toBe(false);
  });

  it("a player can be both favorited and followed independently", () => {
    let s = addFavorite(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = addFollow(s, AARON_JUDGE);
    expect(isFavorite(s, AARON_JUDGE)).toBe(true);
    expect(isFollowing(s, AARON_JUDGE)).toBe(true);
    // Removing one leaves the other intact.
    s = removeFavorite(s, AARON_JUDGE);
    expect(isFavorite(s, AARON_JUDGE)).toBe(false);
    expect(isFollowing(s, AARON_JUDGE)).toBe(true);
  });

  it("never creates a duplicate active follow", () => {
    let s = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = addFollow(s, AARON_JUDGE);
    expect(s.follows.length).toBe(1);
  });

  it("re-following a soft-removed player reactivates and keeps the original createdAt", () => {
    let s = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE, { at: "2026-01-01T00:00:00Z" });
    s = removeFollow(s, AARON_JUDGE);
    expect(isFollowing(s, AARON_JUDGE)).toBe(false);
  });

  it("removeFollow drops the follow so it no longer tracks", () => {
    let s = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = removeFollow(s, AARON_JUDGE);
    expect(isFollowing(s, AARON_JUDGE)).toBe(false);
    expect(activeFollows(s).length).toBe(0);
  });

  it("activeFollows returns active follows most-recent first", () => {
    let s = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE, { at: "2026-08-01T00:00:00Z" });
    s = addFollow(s, SHOHEI, { at: "2026-08-05T00:00:00Z" });
    const active = activeFollows(s);
    expect(active.map((f) => f.playerId)).toEqual([SHOHEI, AARON_JUDGE]);
  });
});

describe("follow display preferences are preference data only (never model input)", () => {
  it("stores preferred metrics without touching identity", () => {
    let s = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = setPreferredMetrics(s, AARON_JUDGE, ["hits", "total_bases"]);
    expect(s.follows[0].preferredMetrics).toEqual(["hits", "total_bases"]);
    expect(s.follows[0].playerId).toBe(AARON_JUDGE);
  });

  it("markViewed records last-viewed without affecting follow membership", () => {
    let s = addFollow(EMPTY_SAVED_STATE, AARON_JUDGE);
    s = markViewed(s, AARON_JUDGE, "2026-08-08T12:00:00Z");
    expect(s.follows[0].lastViewedAt).toBe("2026-08-08T12:00:00Z");
    expect(isFollowing(s, AARON_JUDGE)).toBe(true);
  });
});

describe("operations are pure (return new state, do not mutate)", () => {
  it("addFavorite does not mutate the input state", () => {
    const before = EMPTY_SAVED_STATE;
    const after = addFavorite(before, AARON_JUDGE);
    expect(before.favorites.length).toBe(0);
    expect(after.favorites.length).toBe(1);
    expect(after).not.toBe(before);
  });
});
