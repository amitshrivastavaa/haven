// The declarative half of WebMCP: a tool made from a `<form toolname=…>`,
// which never passes through `registerTool` and so was invisible to the
// takeover until this module existed.
import { expect, test } from "bun:test";
import { schemaFromForm, toolFromForm, type FieldLike, type FormLike } from "../src/declarative.ts";

function field(attrs: Partial<FieldLike> & { name: string; params?: Record<string, string> }): FieldLike {
  const { params = {}, ...rest } = attrs as any;
  return {
    getAttribute: (n: string) => params[n] ?? null,
    ...rest,
  } as FieldLike;
}

function form(attrs: Record<string, string | null>, fields: FieldLike[]): FormLike {
  const held: Record<string, string | null> = { ...attrs };
  let submitted = 0;
  return {
    getAttribute: (n: string) => held[n] ?? null,
    setAttribute: (n: string, v: string) => void (held[n] = v),
    removeAttribute: (n: string) => void delete held[n],
    elements: fields,
    requestSubmit: () => void submitted++,
    get submitCount() { return submitted; },
  } as unknown as FormLike & { submitCount: number };
}

test("derives a schema from the form the way the browser does", () => {
  const f = form({ toolname: "support", tooldescription: "Ask for help." }, [
    field({ name: "firstName", type: "text", labels: [{ textContent: " First Name " }] }),
    field({ name: "age", type: "number" }),
    field({ name: "urgent", type: "checkbox" }),
    field({ name: "team", type: "select-one", required: true,
            params: { toolparamdescription: "Which team" },
            options: [{ value: "returns" }, { value: "delivery" }] }),
    // A submit button is not an input to the tool.
    field({ name: "go", type: "submit" }),
  ]);

  const { properties, required } = schemaFromForm(f);
  expect(Object.keys(properties).sort()).toEqual(["age", "firstName", "team", "urgent"]);
  expect(properties.firstName).toEqual({ type: "string", description: "First Name" });
  expect(properties.age!.type).toBe("number");
  expect(properties.urgent!.type).toBe("boolean");
  expect(properties.team!.description).toBe("Which team");
  expect(properties.team!.enum).toEqual(["returns", "delivery"]);
  expect(required).toEqual(["team"]);
});

test("a form with no toolname is not a tool", () => {
  expect(toolFromForm(form({ tooldescription: "no name here" }, []))).toBeNull();
});

test("executing fills the named fields and leaves submission to the human", async () => {
  const doorId = field({ name: "doorId", type: "text", value: "" });
  const f = form({ toolname: "unlock", tooldescription: "Unlock a door." }, [doorId]);

  const tool = toolFromForm(f)!;
  expect(tool.name).toBe("unlock");
  const result = await tool.execute({ doorId: "front" }, {} as never) as { filled: string[]; submitted: boolean };

  expect(doorId.value).toBe("front");
  expect(result.filled).toEqual(["doorId"]);
  // No `toolautosubmit`, so the declarative contract is that a person submits.
  expect(result.submitted).toBe(false);
  expect((f as unknown as { submitCount: number }).submitCount).toBe(0);
});

test("toolautosubmit is what makes it submit, and it is reported", async () => {
  const q = field({ name: "q", type: "text", value: "" });
  const f = form({ toolname: "search", tooldescription: "Search.", toolautosubmit: "" }, [q]);

  const result = await toolFromForm(f)!.execute({ q: "kettle" }, {} as never) as { submitted: boolean };
  expect(result.submitted).toBe(true);
  expect((f as unknown as { submitCount: number }).submitCount).toBe(1);
});

test("a checkbox takes a boolean, not the string 'false'", async () => {
  const box = field({ name: "urgent", type: "checkbox", checked: true });
  const f = form({ toolname: "t", tooldescription: "d" }, [box]);
  await toolFromForm(f)!.execute({ urgent: false }, {} as never);
  expect(box.checked).toBe(false);
});
