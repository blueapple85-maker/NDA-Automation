# DOC reader provenance

- Upstream: [Alpaq92/JSDoc](https://github.com/Alpaq92/JSDoc)
- Pinned commit: `821695a884e0c0bb8592a635d9524bb3e116cd67`
- Source: [`src/docToText.js`](https://github.com/Alpaq92/JSDoc/blob/821695a884e0c0bb8592a635d9524bb3e116cd67/src/docToText.js)
- License: [0BSD](JSDoc-LICENSE.txt)
- Test fixture generator: upstream `test/make-fixture.js`, stored in `tests/fixtures/make-doc.cjs` under the same license.

The application loads this vendored file locally and calls only `textSections()`. It does not request remote conversion, render the library's generated HTML, execute document macros, or use image extraction.

Local modifications:

- Add a text-only path that skips styled HTML, model generation, image carving, and style/list synthesis. Expose the body including tracked deletions as separate reference material when it differs from the accepted text.
- Limit file, stream, character and allocation sizes; reject invalid/cyclic FAT, mini-FAT, DIFAT and directory chains, invalid text-piece extents, truncated text tables and negative CLX lengths.
- Read root-level streams only, so an embedded document cannot replace the main document.
- Reject invalid/duplicate character-property pages on the text-only path instead of silently discarding deletion metadata.
- Correct the synthetic fixture's directory sibling link.

Support targets unencrypted Word 97–2003 binary DOC files. DOC files containing RTF/HTML, Word 6/95, and files the parser cannot reliably read should be saved as DOCX. Automatic list numbering, complex revisions and object layout require comparison with the original; these limits are included in the review request.
