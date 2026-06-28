/**
 * Shared web-tree-sitter initializer.
 *
 * Both PythonImporter and CppImporter need to call `Parser.init()` before
 * loading any language WASM.  This module ensures it happens exactly once
 * regardless of which importer loads first.
 */

let ParserClass: any = null;
let LanguageClass: any = null;
let initPromise: Promise<void> | null = null;

export async function ensureTreeSitterInit(): Promise<{
  Parser: any;
  Language: any;
}> {
  if (initPromise) {
    await initPromise;
    return { Parser: ParserClass, Language: LanguageClass };
  }

  initPromise = (async () => {
    const wts = await import('web-tree-sitter');
    ParserClass = wts.Parser;
    LanguageClass = wts.Language;
    await ParserClass.init();
  })();

  await initPromise;
  return { Parser: ParserClass, Language: LanguageClass };
}
