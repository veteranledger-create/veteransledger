import { readFileSync, writeFileSync } from "fs";
let content = readFileSync("scripts/write-css-files.mjs", "utf8");
content = content.replace("console.log(  ok )", "console.log(\"  ok \" + filePath)");
content = content.replace("Done.\";\n", "Done.\");\n");
writeFileSync("scripts/write-css-files.mjs", content, "utf8");
console.log("Fixed. Length: " + content.length);
