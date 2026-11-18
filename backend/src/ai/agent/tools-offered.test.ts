import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { toolsOfferedThisTurn } from "../agent.js";

const tool = (name: string): OpenAI.Chat.Completions.ChatCompletionTool => ({
  type: "function",
  function: { name, description: name },
});
const all = [tool("check_availability"), tool("create_appointment"), tool("select_branch")];
const names = (tools: OpenAI.Chat.Completions.ChatCompletionTool[]) =>
  tools.map((t) => (t.type === "function" ? t.function.name : ""));

describe("toolsOfferedThisTurn", () => {
  it("oferece só o que o turno pode executar", () => {
    expect(names(toolsOfferedThisTurn(all, ["check_availability"], false))).toEqual(["check_availability"]);
  });

  it("não oferece ferramenta quando o turno não permite nenhuma", () => {
    expect(toolsOfferedThisTurn(all, [], false)).toEqual([]);
  });

  it("mantém a escolha de filial em número compartilhado", () => {
    expect(names(toolsOfferedThisTurn(all, ["check_availability"], true))).toEqual([
      "check_availability",
      "select_branch",
    ]);
  });
});
