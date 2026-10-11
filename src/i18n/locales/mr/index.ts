// Merges this language's files. Typed as Dictionary: a key missing here is a type error.
import type { Dictionary } from "@/i18n";
import common from "./common";
import report from "./report";
import app from "./app";
import health from "./health";
import account from "./account";

const dictionary: Dictionary = { ...common, ...report, ...app, ...health, ...account };

export default dictionary;
