// Tarayıcı kural seti — v0: yalnızca statik HTML analizi, JS çalıştırılmaz.
// Her kural bir WCAG başarı kriterine bağlıdır. Kaynaksız kural eklenmez.
//
// TASARIM KURALI: yanlış pozitif, kaçırılan bulgudan pahalıdır. Bir kural
// emin değilse "warning" döner, "error" değil. Ajans bize güvenmeyi
// bıraktığı an ürün biter.

const GENERIC_LINK_TEXT = new Set([
  'click here', 'here', 'read more', 'more', 'link', 'this', 'this link',
  'learn more', 'details', 'continue', 'go', 'download',
  'buraya tıkla', 'tıkla', 'devamı', 'daha fazla', 'detaylar', 'buradan',
  'hier klicken', 'mehr', 'weiterlesen', 'mehr erfahren',
  'cliquez ici', 'en savoir plus', 'lire la suite',
  'lees meer', 'klik hier', 'leer más', 'haga clic aquí'
]);

// BCP 47 birincil dil alt etiketi: 2-3 harf, ardından isteğe bağlı alt etiketler.
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const NO_LABEL_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

const FILENAME_ALT_RE = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i;
const SCREAMING_FILENAME_RE = /^(img|dsc|image|photo|pic|untitled|screenshot)[-_ ]?\d+/i;

function text(node) {
  if (!node) return '';
  // node-html-parser .text, tarayıcı DOM .textContent
  const raw = node.text !== undefined ? node.text : node.textContent;
  return (raw || '').replace(/\s+/g, ' ').trim();
}

function attr(el, name) {
  const v = el.getAttribute(name);
  return v === undefined || v === null ? null : v;
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// Bir öğenin erişilebilir isminin var olup olmadığı. Tam ACCNAME algoritması
// değil — statik olarak güvenle söylenebilecek kadarı. Şüphede kalırsa
// "ismi var" kabul eder, çünkü yanlış pozitif daha pahalı.
function hasAccessibleName(el, doc) {
  if (text(el)) return true;
  if (attr(el, 'aria-label')?.trim()) return true;

  const labelledby = attr(el, 'aria-labelledby');
  if (labelledby) {
    const ok = labelledby.split(/\s+/).some((id) => {
      const t = doc.querySelector('[id="' + cssEscape(id) + '"]');
      return t && text(t);
    });
    if (ok) return true;
  }

  if (attr(el, 'title')?.trim()) return true;

  for (const img of el.querySelectorAll('img')) {
    if (attr(img, 'alt')?.trim()) return true;
  }
  for (const svg of el.querySelectorAll('svg')) {
    if (text(svg)) return true; // <title> içeriği
  }
  return false;
}

// tagName kucuk harfe normalize edilir: node-html-parser 'h2', DOM 'H2' dondurur.
function tag(el) {
  return (el.tagName || '').toLowerCase();
}

function isHidden(el) {
  if (attr(el, 'hidden') !== null) return true;
  if (attr(el, 'aria-hidden') === 'true') return true;
  const style = attr(el, 'style') || '';
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

function snippet(el) {
  const raw = (el.outerHTML || '').replace(/\s+/g, ' ').trim();
  return raw.length > 160 ? raw.slice(0, 157) + '...' : raw;
}

export const RULES = [
  {
    id: 'html-lang-missing',
    wcag: '3.1.1',
    slug: 'language-of-page',
    severity: 'error',
    title: 'Page language is not declared',
    why: 'A screen reader cannot tell which pronunciation rules to apply.',
    run(doc) {
      const html = doc.querySelector('html');
      if (!html) return [];
      const lang = attr(html, 'lang');
      if (!lang || !lang.trim()) {
        return [{
          evidence: 'The html element has no lang attribute',
          fix: 'Add the actual language of the page to the html element, e.g. <html lang="de">'
        }];
      }
      return [];
    }
  },
  {
    id: 'html-lang-invalid',
    wcag: '3.1.1',
    slug: 'language-of-page',
    severity: 'error',
    title: 'Page language uses an invalid code',
    why: 'An invalid language code has the same effect as declaring none at all.',
    run(doc) {
      const html = doc.querySelector('html');
      const lang = html ? attr(html, 'lang') : null;
      if (!lang || !lang.trim()) return [];
      if (!LANG_RE.test(lang.trim())) {
        return [{
          evidence: 'lang="' + lang + '"',
          fix: 'Use a valid BCP 47 code (for example "de", "fr-BE", "nl").'
        }];
      }
      return [];
    }
  },
  {
    id: 'title-missing',
    wcag: '2.4.2',
    slug: 'page-titled',
    severity: 'error',
    title: 'Page title is missing or empty',
    why: 'The title is the first thing a screen reader announces when moving between tabs.',
    run(doc) {
      const t = doc.querySelector('title');
      if (!t) return [{ evidence: 'There is no title element', fix: 'Add a title element in the head describing what the page is about.' }];
      if (!text(t)) return [{ evidence: 'The title element is empty', fix: 'Fill the title with the subject of the page.' }];
      return [];
    }
  },
  {
    id: 'title-generic',
    wcag: '2.4.2',
    slug: 'page-titled',
    severity: 'warning',
    title: 'Page title is not distinctive',
    why: 'Pages sharing one title cannot be told apart.',
    run(doc) {
      const t = text(doc.querySelector('title'));
      if (!t) return [];
      const generic = ['home', 'untitled', 'ana sayfa', 'shop', 'mağaza', 'page', 'document', 'new page'];
      if (generic.includes(t.toLowerCase())) {
        return [{ evidence: '<title>' + t + '</title>', fix: 'Make the title specific to this page and append the store name.' }];
      }
      return [];
    }
  },
  {
    id: 'img-missing-alt',
    wcag: '1.1.1',
    slug: 'non-text-content',
    severity: 'error',
    title: 'Image has no alt attribute',
    why: 'alt="" is valid for a decorative image; omitting the attribute entirely makes a screen reader read the filename.',
    run(doc) {
      const out = [];
      for (const img of doc.querySelectorAll('img')) {
        if (isHidden(img)) continue;
        const role = (attr(img, 'role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') continue;
        if (attr(img, 'alt') === null) {
          out.push({
            evidence: snippet(img),
            fix: 'Write descriptive alt text if it carries information; leave alt="" if it is decorative.'
          });
        }
      }
      return out;
    }
  },
  {
    id: 'img-alt-filename',
    wcag: '1.1.1',
    slug: 'non-text-content',
    severity: 'warning',
    title: 'Alt text looks like a filename',
    why: 'Reading out "IMG_4821.jpg" tells the customer nothing.',
    run(doc) {
      const out = [];
      for (const img of doc.querySelectorAll('img')) {
        const alt = (attr(img, 'alt') || '').trim();
        if (!alt) continue;
        if (FILENAME_ALT_RE.test(alt) || SCREAMING_FILENAME_RE.test(alt)) {
          out.push({ evidence: 'alt="' + alt + '"', fix: 'Replace the alt text with what the image actually conveys.' });
        }
      }
      return out;
    }
  },
  {
    id: 'form-label-missing',
    wcag: '1.3.1',
    slug: 'info-and-relationships',
    severity: 'error',
    title: 'Form field label is not programmatically associated',
    why: 'An unlabelled field in checkout means an abandoned order.',
    run(doc) {
      const out = [];
      const fields = [
        ...doc.querySelectorAll('input'),
        ...doc.querySelectorAll('select'),
        ...doc.querySelectorAll('textarea')
      ];
      for (const f of fields) {
        if (isHidden(f)) continue;
        const t = tag(f);
        const type = (attr(f, 'type') || 'text').toLowerCase();
        if (t === 'input' && NO_LABEL_TYPES.has(type)) continue;

        if (attr(f, 'aria-label')?.trim()) continue;
        if (attr(f, 'aria-labelledby')?.trim()) continue;
        if (attr(f, 'title')?.trim()) continue;

        const id = attr(f, 'id');
        if (id && doc.querySelector('label[for="' + cssEscape(id) + '"]')) continue;

        // sarmalayan <label>
        let p = f.parentNode;
        let wrapped = false;
        for (let i = 0; i < 4 && p; i++) {
          if (tag(p) === 'label') { wrapped = true; break; }
          p = p.parentNode;
        }
        if (wrapped) continue;

        const ph = (attr(f, 'placeholder') || '').trim();
        out.push({
          evidence: snippet(f),
          fix: ph
            ? 'A placeholder is not a label — it disappears as soon as the customer types. Add a visible label with a for attribute.'
            : 'Add a visible label associated with the field via label/for.'
        });
      }
      return out;
    }
  },
  {
    id: 'heading-order',
    wcag: '1.3.1',
    slug: 'info-and-relationships',
    severity: 'warning',
    title: 'Heading level skipped',
    why: 'Screen reader users navigate by heading list; a skipped level breaks the outline.',
    run(doc) {
      const out = [];
      let prev = 0;
      for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
        if (isHidden(h)) continue;
        const lvl = Number(tag(h).slice(1));
        if (prev && lvl > prev + 1) {
          out.push({
            evidence: '<h' + lvl + '> follows <h' + prev + '>: "' + text(h).slice(0, 60) + '"',
            fix: 'Change it to h' + (prev + 1) + ', or add the missing heading in between.'
          });
        }
        prev = lvl;
      }
      return out;
    }
  },
  {
    id: 'h1-missing',
    wcag: '1.3.1',
    slug: 'info-and-relationships',
    severity: 'warning',
    title: 'Page has no h1',
    why: 'There is no top-level heading naming the subject of the page.',
    run(doc) {
      const h1s = [...doc.querySelectorAll('h1')].filter((h) => !isHidden(h));
      if (h1s.length === 0) {
        return [{ evidence: 'No h1 found', fix: 'State the subject of the page in a single h1.' }];
      }
      return [];
    }
  },
  {
    id: 'link-no-name',
    wcag: '2.4.4',
    slug: 'link-purpose-in-context',
    severity: 'error',
    title: 'Link has no accessible name',
    why: 'A screen reader announces it only as "link"; the destination is unknown.',
    run(doc) {
      const out = [];
      for (const a of doc.querySelectorAll('a')) {
        if (isHidden(a)) continue;
        if (attr(a, 'href') === null) continue;
        if (!hasAccessibleName(a, doc)) {
          out.push({
            evidence: snippet(a),
            fix: 'Add visible text, or an aria-label on icon links.'
          });
        }
      }
      return out;
    }
  },
  {
    id: 'link-generic-text',
    wcag: '2.4.4',
    slug: 'link-purpose-in-context',
    severity: 'warning',
    title: 'Link text has no context',
    why: 'A user hearing "click here" repeatedly cannot tell the links apart.',
    run(doc) {
      const out = [];
      for (const a of doc.querySelectorAll('a')) {
        if (isHidden(a)) continue;
        const t = text(a).toLowerCase().replace(/[.!:»>\u2192\u2026]+$/g, '').trim();
        if (t && GENERIC_LINK_TEXT.has(t)) {
          out.push({
            evidence: '<a>' + text(a) + '</a>',
            fix: 'Write link text that names the destination ("Read the shipping terms").'
          });
        }
      }
      return out;
    }
  },
  {
    id: 'button-no-name',
    wcag: '4.1.2',
    slug: 'name-role-value',
    severity: 'error',
    title: 'Button has no accessible name',
    why: 'Icon buttons such as cart, search and wishlist are the usual offenders.',
    run(doc) {
      const out = [];
      for (const b of doc.querySelectorAll('button')) {
        if (isHidden(b)) continue;
        if (!hasAccessibleName(b, doc)) {
          out.push({
            evidence: snippet(b),
            fix: 'Add an aria-label (for example aria-label="Open cart") or visually hidden text.'
          });
        }
      }
      return out;
    }
  },
  {
    id: 'duplicate-id',
    wcag: '4.1.2',
    slug: 'name-role-value',
    severity: 'warning',
    title: 'The same id is used on more than one element',
    why: 'label/for and aria-labelledby then resolve to the wrong element.',
    run(doc) {
      const seen = new Map();
      for (const el of doc.querySelectorAll('[id]')) {
        const id = attr(el, 'id');
        if (!id) continue;
        seen.set(id, (seen.get(id) || 0) + 1);
      }
      return [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([id, n]) => ({
          evidence: 'id="' + id + '" — used ' + n + ' times',
          fix: 'Every id must be unique within the page.'
        }));
    }
  },
  {
    id: 'viewport-scaling-blocked',
    wcag: '1.4.4',
    slug: 'resize-text',
    severity: 'error',
    title: 'Zoom is disabled',
    why: 'Low-vision customers cannot enlarge text on mobile.',
    run(doc) {
      const m = doc.querySelector('meta[name="viewport"]');
      const c = m ? (attr(m, 'content') || '') : '';
      const bad = [];
      if (/user-scalable\s*=\s*(no|0)/i.test(c)) bad.push('user-scalable=no');
      const max = c.match(/maximum-scale\s*=\s*([0-9.]+)/i);
      if (max && Number(max[1]) < 2) bad.push('maximum-scale=' + max[1]);
      if (bad.length) {
        return [{
          evidence: 'viewport: ' + bad.join(', '),
          fix: 'Remove the user-scalable=no and maximum-scale restrictions.'
        }];
      }
      return [];
    }
  }
];
