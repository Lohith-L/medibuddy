// Merges this language's files. Typed as Dictionary: a key missing here is a type error.
import type { Dictionary } from "@/i18n";
import common from "./common";
import report from "./report";
import app from "./app";
import health from "./health";
import account from "./account";
import alarmVoice from "./alarmVoice";
import care from "./care";
import sosAlert from "./sosAlert";
import start from "./start";
import theme from "./theme";
import locperm from "./locperm";

const dictionary: Dictionary = { ...common, ...report, ...app, ...health, ...account, ...alarmVoice, ...care, ...sosAlert, ...start, ...theme, ...locperm };

export default dictionary;
