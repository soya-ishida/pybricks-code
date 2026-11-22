'use strict';

// Filters the bundled Pybricks API documentation (@pybricks/ide-docs) down
// to the pages that apply to the LEGO SPIKE Prime kit, so the built-in help
// only covers what kids can actually use with their kit.
//
// This is used by the CopyPlugin pattern for the docs in webpack.config.js:
// - `isRemovedDocPage` is used as the pattern `filter` so removed pages are
//   not copied to the build output at all.
// - `transformDoc` post-processes the remaining pages: links to removed
//   pages are stripped (see processHtml) and the full-text search index is
//   rebuilt without the removed pages and with Japanese search terms for
//   the translated pages (see processSearchIndex).
//
// The keep/remove list and the reasoning behind it are documented in
// docs-filter-plan.md in the pybricks-code-ja project folder.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const docsTranslationsJa = require('./docsTranslationsJa');

const docsRoot = path.join(
    path.dirname(require.resolve('@pybricks/ide-docs/package.json')),
    'html',
);

// Pages to remove, as POSIX-style paths relative to the docs root.
const removedDocPages = [
    // Hubs other than the Prime Hub.
    'hubs/cityhub.html',
    'hubs/essentialhub.html',
    'hubs/movehub.html',
    'hubs/technichub.html',
    // Powered Up devices that are not part of the SPIKE Prime kit.
    'pupdevices/colordistancesensor.html',
    'pupdevices/dcmotor.html',
    'pupdevices/infraredsensor.html',
    'pupdevices/light.html',
    'pupdevices/pfmotor.html',
    'pupdevices/remote.html',
    'pupdevices/tiltsensor.html',
    // Custom (non-kit) devices.
    'iodevices/index.html',
    'iodevices/lwp3device.html',
    'iodevices/pupdevice.html',
    'iodevices/xboxcontroller.html',
];

const removedDocPageSet = new Set(removedDocPages);

// Docnames as they appear in searchindex.js (page path without extension).
const removedDocNameSet = new Set(
    removedDocPages.map((page) => page.replace(/\.html$/, '')),
);

function toRelativeDocsPath(absolutePath) {
    return path.relative(docsRoot, absolutePath).split(path.sep).join('/');
}

/**
 * CopyPlugin `filter` helper: true if the file is a removed doc page.
 */
function isRemovedDocPage(absolutePath) {
    return removedDocPageSet.has(toRelativeDocsPath(absolutePath));
}

/**
 * Resolves an href found on the page at `pageRelPath` (docs-root-relative)
 * to a docs-root-relative path, or null for external links, links that
 * escape the docs root, and pure in-page anchors.
 */
function resolveLinkTarget(pageRelPath, href) {
    if (!href || href.startsWith('#') || href.startsWith('//')) {
        return null;
    }
    // Anything with a URL scheme (https:, mailto:, ...) is external.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return null;
    }
    const noFragment = href.split('#')[0].split('?')[0];
    if (!noFragment) {
        return null;
    }
    let decoded = noFragment;
    try {
        decoded = decodeURIComponent(noFragment);
    } catch {
        // Keep the raw value if it is not valid percent-encoding.
    }
    const joined = path.posix.normalize(
        path.posix.join(path.posix.dirname(pageRelPath), decoded),
    );
    if (joined.startsWith('..')) {
        return null;
    }
    return joined;
}

/**
 * Removes everything in an HTML page that links to removed doc pages:
 * sidebar/table-of-contents entries and prev/next navigation are removed
 * entirely, while inline links in body text are unwrapped so the text
 * itself is kept.
 */
function processHtml(html, pageRelPath) {
    const dom = new JSDOM(html);
    const { document } = dom.window;

    const isRemovedTarget = (href) => {
        const target = resolveLinkTarget(pageRelPath, href);
        return target !== null && removedDocPageSet.has(target);
    };

    // Prev/next page links in <head>.
    document
        .querySelectorAll('link[rel="next"], link[rel="prev"]')
        .forEach((el) => {
            if (isRemovedTarget(el.getAttribute('href'))) {
                el.remove();
            }
        });

    const pageName = path.posix.basename(pageRelPath);

    document.querySelectorAll('a[href]').forEach((a) => {
        if (!isRemovedTarget(a.getAttribute('href'))) {
            return;
        }

        // Sidebar menu and in-body tables of contents: drop the whole entry.
        const menuItem = a.closest('.wy-menu li, .toctree-wrapper li');
        if (menuItem) {
            menuItem.remove();
            return;
        }

        // Prev/next buttons in the page footer.
        if (a.classList.contains('btn')) {
            a.remove();
            return;
        }

        // Index pages: drop the whole index entry/row.
        if (pageName === 'genindex.html') {
            const li = a.closest('li');
            if (li) {
                li.remove();
                return;
            }
        }
        if (pageName === 'py-modindex.html') {
            const tr = a.closest('tr');
            if (tr) {
                tr.remove();
                return;
            }
        }

        // Image-only links: drop the image, and the figure if it becomes
        // empty (e.g. the device pictures on the docs front page).
        if (a.querySelector('img') && a.textContent.trim() === '') {
            const figure = a.closest('figure');
            a.remove();
            if (
                figure &&
                figure.textContent.trim() === '' &&
                figure.querySelectorAll('img, a').length === 0
            ) {
                figure.remove();
            }
            return;
        }

        // Inline link in body text: keep the text, drop the link.
        a.replaceWith(...a.childNodes);
    });

    applyDocTranslations(document, pageRelPath);

    return dom.serialize();
}

// ---------------------------------------------------------------------------
// Japanese translation of the main documentation pages.
//
// The translation data lives in docsTranslationsJa.js. Matching is done on
// whitespace-normalized text, so wording changes upstream simply leave the
// English text in place (fail-safe) instead of breaking the build.
// ---------------------------------------------------------------------------

const docBlockTags = new Set([
    'P',
    'LI',
    'DD',
    'DT',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'TD',
    'TH',
    'CAPTION',
    'BLOCKQUOTE',
]);
const docBlockDescendants = new Set([
    ...docBlockTags,
    'UL',
    'OL',
    'DL',
    'DIV',
    'SECTION',
    'TABLE',
    'FIGURE',
]);
const docSkipAncestorSelector =
    'script, style, pre, dt.sig, noscript, textarea, .wy-menu, nav';
const docTextSkipAncestorSelector =
    'script, style, pre, code, dt.sig, noscript, textarea';

function normalizeDocText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Builds the lookup key for a block element: its text with every inline
 * element replaced by a {n} placeholder. Returns null when the element is
 * not a self-contained unit (it has block-level descendants).
 */
function buildDocBlockKey(element) {
    const placeholders = [];
    let key = '';
    let failed = false;
    const walk = (node) => {
        node.childNodes.forEach((child) => {
            if (failed) {
                return;
            }
            if (child.nodeType === 3) {
                key += child.nodeValue;
            } else if (child.nodeType === 1) {
                if (
                    child.tagName === 'A' &&
                    child.classList.contains('headerlink')
                ) {
                    return;
                }
                if (docBlockDescendants.has(child.tagName)) {
                    failed = true;
                    return;
                }
                if (child.tagName === 'BR') {
                    key += ' ';
                    return;
                }
                placeholders.push(child);
                key += `{${placeholders.length - 1}}`;
            }
        });
    };
    walk(element);
    if (failed) {
        return null;
    }
    return { key: normalizeDocText(key), placeholders };
}

/**
 * Replaces the contents of a block element with its Japanese translation.
 * {n} inserts a copy of the original inline element; {n=text} also
 * replaces that element's text (used for emphasis and link labels).
 */
function applyDocBlockTranslation(document, element, translation, placeholders) {
    // Headings keep their permalink anchor.
    const headerlink = element.querySelector('a.headerlink');
    const savedHeaderlink = headerlink ? headerlink.cloneNode(true) : null;

    const fragment = document.createDocumentFragment();
    const pattern = /\{(\d+)(?:=([^{}]*))?\}/g;
    let lastIndex = 0;
    let match;
    const pushText = (text) => {
        if (text) {
            fragment.appendChild(document.createTextNode(text));
        }
    };
    while ((match = pattern.exec(translation)) !== null) {
        pushText(translation.slice(lastIndex, match.index));
        const original = placeholders[Number(match[1])];
        if (original) {
            const copy = original.cloneNode(true);
            if (match[2] !== undefined) {
                copy.textContent = match[2];
            }
            fragment.appendChild(copy);
        }
        lastIndex = pattern.lastIndex;
    }
    pushText(translation.slice(lastIndex));
    if (savedHeaderlink) {
        fragment.appendChild(savedHeaderlink);
    }

    element.replaceChildren(fragment);
}

function applyDocTranslations(document, pageRelPath) {
    const { blocks, plain, titles } = docsTranslationsJa;

    if (titles[pageRelPath]) {
        document.title = titles[pageRelPath];
    }

    // Block-level units (paragraphs, headings, parameter entries, ...).
    document
        .querySelectorAll([...docBlockTags].join(',').toLowerCase())
        .forEach((element) => {
            if (element.closest(docSkipAncestorSelector)) {
                return;
            }
            if (
                element.tagName === 'DT' &&
                element.classList.contains('sig')
            ) {
                return;
            }
            const built = buildDocBlockKey(element);
            if (!built || !built.key || !/[A-Za-z]/.test(built.key)) {
                return;
            }
            const translation = blocks[built.key];
            if (translation) {
                applyDocBlockTranslation(
                    document,
                    element,
                    translation,
                    built.placeholders,
                );
            }
        });

    // Table-of-contents links (sidebar and in-body TOCs): their text is
    // split into text nodes and inline elements (e.g. a <code> module
    // name), so they are matched as block units of their own. This
    // propagates the translated headings of the main pages to the sidebar
    // shown on every page.
    document
        .querySelectorAll(
            '.wy-menu a, nav a, .toctree-wrapper a, .wy-breadcrumbs a',
        )
        .forEach((anchor) => {
            const built = buildDocBlockKey(anchor);
            if (!built || !built.key || !/[A-Za-z]/.test(built.key)) {
                return;
            }
            const translation = blocks[built.key];
            if (translation) {
                applyDocBlockTranslation(
                    document,
                    anchor,
                    translation,
                    built.placeholders,
                );
            }
        });

    // Bare text nodes: short labels and any remaining heading copies.
    const walker = document.createTreeWalker(
        document.body,
        document.defaultView.NodeFilter.SHOW_TEXT,
    );
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }
    textNodes.forEach((textNode) => {
        const parent = textNode.parentElement;
        if (!parent || parent.closest(docTextSkipAncestorSelector)) {
            return;
        }
        const raw = textNode.nodeValue;
        const normalized = normalizeDocText(raw);
        const translation = plain[normalized];
        if (!translation) {
            return;
        }
        const leading = raw.match(/^\s*/)[0];
        const trailing = raw.match(/\s*$/)[0];
        textNode.nodeValue = leading + translation + trailing;
    });
}

/**
 * Adds a term -> document entry to a Sphinx term map (`terms` or
 * `titleterms`), normalizing the existing value (a document index or an
 * array of them) to an array.
 */
function addSearchTerm(map, term, docIndex) {
    if (!term) {
        return;
    }
    const existing = map[term];
    if (existing === undefined) {
        map[term] = [docIndex];
    } else if (Array.isArray(existing)) {
        if (!existing.includes(docIndex)) {
            existing.push(docIndex);
        }
    } else if (existing !== docIndex) {
        map[term] = [existing, docIndex];
    }
}

/**
 * Flattens a block translation (with {n} / {n=text} placeholders) into the
 * plain text that ends up on the translated page, for use as a search term.
 */
function translationToTermText(translation, placeholders) {
    return normalizeDocText(
        translation.replace(/\{(\d+)(?:=([^{}]*))?\}/g, (match, n, text) => {
            if (text !== undefined) {
                return text;
            }
            const original = placeholders[Number(n)];
            return original ? original.textContent : '';
        }),
    );
}

/**
 * Makes the translated main pages findable by their Japanese text.
 *
 * The upstream index is built from the English pages, so Japanese queries
 * would find nothing on pages whose body and headings are now Japanese.
 * Sphinx splits queries on non-letter characters and its stemmer leaves
 * Japanese words unchanged, so registering each full Japanese title and
 * heading as a term works: exact queries match directly, and shorter
 * queries match as substrings via the partial-match fallback.
 */
function addJapaneseSearchTerms(index) {
    const { blocks, titles } = docsTranslationsJa;
    if (!index.terms) {
        index.terms = {};
    }
    if (!index.titleterms) {
        index.titleterms = {};
    }

    const docIndexByName = new Map();
    index.docnames.forEach((name, i) => docIndexByName.set(name, i));

    for (const [pageRelPath, jaTitle] of Object.entries(titles)) {
        const docIndex = docIndexByName.get(pageRelPath.replace(/\.html$/, ''));
        if (docIndex === undefined) {
            continue; // Not a kept page.
        }

        // Show the Japanese title in the search results. The configured
        // title is the full <title> text; drop the documentation suffix.
        const shortTitle = normalizeDocText(jaTitle.split(' — ')[0]);
        index.titles[docIndex] = shortTitle;

        const terms = new Set([shortTitle]);
        // Component words of compound titles, e.g. the two hub names in
        // "プライムハブ／インベンターハブ".
        shortTitle
            .split(/[／・、\s]+/)
            .forEach((word) => terms.add(word));

        // Translated headings of this page, recovered from the original
        // HTML with the same matching the page translation uses.
        let html = null;
        try {
            html = fs.readFileSync(path.join(docsRoot, pageRelPath), 'utf8');
        } catch {
            // Title-only registration still applies.
        }
        if (html) {
            const { document } = new JSDOM(html).window;
            document
                .querySelectorAll('h1, h2, h3, h4')
                .forEach((element) => {
                    if (element.closest(docSkipAncestorSelector)) {
                        return;
                    }
                    const built = buildDocBlockKey(element);
                    if (!built || !built.key) {
                        return;
                    }
                    const translation = blocks[built.key];
                    if (translation) {
                        terms.add(
                            translationToTermText(
                                translation,
                                built.placeholders,
                            ),
                        );
                    }
                });
        }

        terms.forEach((term) => {
            if (term) {
                addSearchTerm(index.titleterms, term, docIndex);
                addSearchTerm(index.terms, term, docIndex);
            }
        });
    }
}

/**
 * Rebuilds the Sphinx search index without the removed documents,
 * renumbering the remaining documents so all cross-references
 * (terms, title terms, objects) stay consistent.
 */
function processSearchIndex(content) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    const index = JSON.parse(content.slice(start, end + 1));

    // Map of old document index -> new document index for kept documents.
    const remap = new Map();
    const kept = [];
    index.docnames.forEach((name, i) => {
        if (!removedDocNameSet.has(name)) {
            remap.set(i, kept.length);
            kept.push(i);
        }
    });
    const pick = (arr) => kept.map((i) => arr[i]);
    index.docnames = pick(index.docnames);
    index.filenames = pick(index.filenames);
    index.titles = pick(index.titles);

    // Term values are a document index or a (nested) array of them.
    const remapValue = (value) => {
        if (Array.isArray(value)) {
            const out = value
                .map(remapValue)
                .filter((v) => v !== undefined);
            return out.length > 0 ? out : undefined;
        }
        return remap.has(value) ? remap.get(value) : undefined;
    };
    for (const key of ['terms', 'titleterms']) {
        if (!index[key]) {
            continue;
        }
        const out = {};
        for (const [term, value] of Object.entries(index[key])) {
            const remapped = remapValue(value);
            if (remapped !== undefined) {
                out[term] = remapped;
            }
        }
        index[key] = out;
    }

    // Object entries start with the document index they point to.
    if (index.objects) {
        const remapEntry = (entry) =>
            Array.isArray(entry) && remap.has(entry[0])
                ? [remap.get(entry[0]), ...entry.slice(1)]
                : undefined;
        const out = {};
        for (const [prefix, entries] of Object.entries(index.objects)) {
            if (Array.isArray(entries)) {
                const filtered = entries
                    .map(remapEntry)
                    .filter((e) => e !== undefined);
                if (filtered.length > 0) {
                    out[prefix] = filtered;
                }
            } else if (entries && typeof entries === 'object') {
                const sub = {};
                for (const [name, entry] of Object.entries(entries)) {
                    const remapped = remapEntry(entry);
                    if (remapped !== undefined) {
                        sub[name] = remapped;
                    }
                }
                if (Object.keys(sub).length > 0) {
                    out[prefix] = sub;
                }
            }
        }
        index.objects = out;
    }

    addJapaneseSearchTerms(index);

    return `Search.setIndex(${JSON.stringify(index)})`;
}

/**
 * CopyPlugin `transform` for the docs pattern: post-processes HTML pages
 * and the search index, and passes everything else through unchanged.
 */
function transformDoc(content, absoluteFrom) {
    const relPath = toRelativeDocsPath(absoluteFrom);
    if (relPath === 'searchindex.js') {
        return processSearchIndex(content.toString());
    }
    if (relPath.endsWith('.html')) {
        return processHtml(content.toString(), relPath);
    }
    return content;
}

module.exports = { isRemovedDocPage, transformDoc };
