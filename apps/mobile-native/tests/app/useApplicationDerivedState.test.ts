jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { signOut: jest.fn(async () => undefined) },
}));

import { act, renderHook } from "@testing-library/react-native";
import { useApplicationDerivedState } from "../../src/app/useApplicationDerivedState";
import { useApplicationState } from "../../src/app/useApplicationState";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";

describe("useApplicationDerivedState", () => {
  it("keeps a fresh announcements feed healthy when the legacy summer-school feed is partial", () => {
    const { result } = renderHook(() => {
      const state = useApplicationState();
      return { state, derived: useApplicationDerivedState(state) };
    });

    act(() => {
      result.current.state.setAnnouncements({
        loading: false,
        attempted: true,
        data: {
          items: [trustedRecord()],
          state: "fresh",
          omittedCount: 0,
          duplicateCount: 0,
          rawItemCount: 1,
        },
      });
      result.current.state.setSummerSchool({
        loading: false,
        attempted: true,
        stale: true,
        error: "Legacy summer-school source failed",
        data: {
          profile: { universityId: "university-1" },
          requirements: [],
          ownAnnouncements: [],
          sameDepartmentAnnouncements: [],
          sameDepartmentOptions: [],
          generatedAt: "2026-09-14T00:00:00.000Z",
          contentState: "partial",
        },
      });
    });

    expect(result.current.derived.contentFeedError).toBeUndefined();
    expect(result.current.derived.contentFeedPartial).toBe(false);
    expect(result.current.derived.contentFeedStale).toBe(false);
    expect(result.current.derived.summerAvailabilityMessage).not.toBeNull();
  });

  it("reports a partial feed when academic sources fail and only secondary items remain", () => {
    const { result } = renderHook(() => {
      const state = useApplicationState();
      return { state, derived: useApplicationDerivedState(state) };
    });

    act(() => {
      result.current.state.setAnnouncements({
        loading: false,
        attempted: true,
        error: "Academic sources failed",
      });
      result.current.state.setSummerSchool({
        loading: false,
        attempted: true,
        data: {
          profile: { universityId: "university-1" },
          requirements: [],
          ownAnnouncements: [trustedRecord()],
          sameDepartmentAnnouncements: [],
          sameDepartmentOptions: [],
          generatedAt: "2026-09-14T00:00:00.000Z",
          contentState: "fresh",
        },
      });
    });

    expect(result.current.derived.contentFeedError).toBe("Academic sources failed");
    expect(result.current.derived.contentFeedPartial).toBe(true);
    expect(result.current.derived.contentFeedStale).toBe(false);
  });
});

function trustedRecord(): TrustedMobileContentRecord {
  return {
    id: "source-1-item-1",
    sourceId: "source-1",
    sourceName: "Example University",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Fresh announcement",
    link: "https://example.edu.tr/announcements/1",
    canonicalUrl: "https://example.edu.tr/announcements/1",
    canonicalUrlAliases: [],
    officialSourceUrl: "https://example.edu.tr/announcements",
    sourceRelationships: [{
      sourceId: "source-1",
      sourceName: "Example University",
      officialSourceUrl: "https://example.edu.tr/announcements",
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl: "https://example.edu.tr/announcements/1",
    }],
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
