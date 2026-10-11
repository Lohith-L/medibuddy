// Merges this language's files. Typed as Dictionary: a key missing here is a type error.
import type { Dictionary } from "@/i18n";
import common from "./common";
import report from "./report";
import app from "./app";

const dictionary: Dictionary = { ...common, ...report, ...app };

export default dictionary;
