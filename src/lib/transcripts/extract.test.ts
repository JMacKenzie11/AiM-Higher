import { describe, it, expect } from "vitest";
import { cleanVtt } from "./extract";

describe("cleanVtt", () => {
  it("keeps a Teams voice tag as the speaker's name", () => {
    // The shape Microsoft Graph returns for a Teams transcript.
    const raw = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:04.120",
      "<v Jason MacKenzie>Morning, everyone. Let's start with the numbers.</v>",
      "",
      "00:00:04.120 --> 00:00:07.500",
      "<v Joel Burger>Revenue is up eight percent.</v>",
    ].join("\n");
    expect(cleanVtt(raw)).toBe(
      "Jason MacKenzie: Morning, everyone. Let's start with the numbers.\n\nJoel Burger: Revenue is up eight percent."
    );
  });

  it("keeps a voice tag that carries a class, and the cue's other lines", () => {
    const raw = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n<v.loud Ana Ruiz>We ship Friday.\nNo slipping.</v>";
    expect(cleanVtt(raw)).toBe("Ana Ruiz: We ship Friday.\nNo slipping.");
  });

  it("leaves a VTT with no voice tags as it was", () => {
    const raw = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSpeaker 1: Hello <c.yellow>there</c>.";
    expect(cleanVtt(raw)).toBe("Speaker 1: Hello there.");
  });
});
