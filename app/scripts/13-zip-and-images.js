  /* =====================================================================
     6. ZIP BANKS
     A .zip holds one unit file (.txt) and images named Img.Q<n>.<ext> (in
     any folder), where n is the question's number in the file, counting
     from 1. The images are written into the bank's text (see
     IMAGE_SECTION), so everything after this works on one text as before.
     ===================================================================== */

  var MAX_ZIP_BYTES = 40 * 1024 * 1024;
  var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  var MAX_IMAGES_TOTAL = 25 * 1024 * 1024;
  // Decoded size: a small file can still be a huge picture.
  var MAX_IMAGE_SIDE = 12000, MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
  var IMAGE_MEASURE_MS = 15000;

  /* The zip reader is one self-contained function (it uses nothing from
     outside itself), so the same code runs in a background worker, keeping
     the page responsive while a big zip is unpacked, or right here when a
     worker can't be started. */
  function makeZipKit() {
    /* ------------------------------ Inflate ------------------------------
       Raw DEFLATE (RFC 1951), for zips opened where the browser has no
       DecompressionStream. Small and plain rather than fast. */
    var INF_LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var INF_LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var INF_DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var INF_DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var INF_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function inflateRaw(src, size) {
      var damaged = function () { return new Error("A file in the .zip is damaged."); };
      var out = new Uint8Array(size), op = 0;
      var pos = 0, buf = 0, cnt = 0;
      function bits(n) {
        while (cnt < n) {
          if (pos >= src.length) throw damaged();
          buf |= src[pos++] << cnt;
          cnt += 8;
        }
        var v = buf & ((1 << n) - 1);
        buf >>>= n;
        cnt -= n;
        return v;
      }
      function table(lengths) {
        var count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(lengths.length);
        for (var i = 0; i < lengths.length; i++) count[lengths[i]]++;
        count[0] = 0;
        for (var l = 1; l < 16; l++) offs[l] = offs[l - 1] + count[l - 1];
        for (var s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
        return { count: count, symbol: symbol };
      }
      function decode(h) {
        var code = 0, first = 0, index = 0;
        for (var len = 1; len < 16; len++) {
          code |= bits(1);
          var c = h.count[len];
          if (code - c < first) return h.symbol[index + (code - first)];
          index += c;
          first = (first + c) << 1;
          code <<= 1;
        }
        throw damaged();
      }
      function put(b) { if (op >= size) throw damaged(); out[op++] = b; }
      var fixedL = null, fixedD = null, last = 0;
      while (!last) {
        last = bits(1);
        var type = bits(2);
        if (type === 0) {
          buf = 0; cnt = 0;
          if (pos + 4 > src.length) throw damaged();
          var len0 = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
          pos += 4;
          if ((len0 ^ 0xffff) !== nlen || pos + len0 > src.length) throw damaged();
          for (var k = 0; k < len0; k++) put(src[pos++]);
          continue;
        }
        var lt, dt;
        if (type === 1) {
          if (!fixedL) {
            var fl = [];
            for (var a = 0; a < 288; a++) fl.push(a < 144 ? 8 : a < 256 ? 9 : a < 280 ? 7 : 8);
            var fd = [];
            for (var d = 0; d < 30; d++) fd.push(5);
            fixedL = table(fl); fixedD = table(fd);
          }
          lt = fixedL; dt = fixedD;
        } else if (type === 2) {
          var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          var cl = [];
          for (var z = 0; z < 19; z++) cl.push(0);
          for (var y = 0; y < hclen; y++) cl[INF_ORDER[y]] = bits(3);
          var ct = table(cl), lens = [];
          while (lens.length < hlit + hdist) {
            var sym = decode(ct);
            if (sym < 16) lens.push(sym);
            else {
              var rep, val = 0;
              if (sym === 16) { if (!lens.length) throw damaged(); val = lens[lens.length - 1]; rep = 3 + bits(2); }
              else if (sym === 17) rep = 3 + bits(3);
              else rep = 11 + bits(7);
              while (rep--) lens.push(val);
            }
          }
          if (lens.length > hlit + hdist) throw damaged();
          lt = table(lens.slice(0, hlit));
          dt = table(lens.slice(hlit));
        } else throw damaged();
        for (;;) {
          var s2 = decode(lt);
          if (s2 < 256) put(s2);
          else if (s2 === 256) break;
          else {
            s2 -= 257;
            if (s2 >= 29) throw damaged();
            var length = INF_LBASE[s2] + bits(INF_LEXT[s2]);
            var ds = decode(dt);
            if (ds >= 30) throw damaged();
            var dist = INF_DBASE[ds] + bits(INF_DEXT[ds]);
            if (dist > op) throw damaged();
            for (var m = 0; m < length; m++) put(out[op - dist]);
          }
        }
      }
      if (op !== size) throw damaged();
      return out;
    }

    /* Decompress one entry to exactly `size` bytes. The browser's own
       decoder is read a chunk at a time and stopped as soon as it gives more
       than the zip said, so a small damaged or hostile zip can't expand
       without limit. */
    function inflateEntry(data, size) {
      var damaged = function () { var e = new Error("A file in the .zip is damaged."); e.zipDamaged = true; return e; };
      if (typeof DecompressionStream === "function" && typeof Blob === "function") {
        var reader;
        try {
          reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        } catch (err) { reader = null; }
        if (reader) {
          var out = new Uint8Array(size), got = 0, tooBig = false;
          var pump = function () {
            return reader.read().then(function (r) {
              if (r.done) return;
              if (got + r.value.length > size) { tooBig = true; return reader.cancel().catch(function () {}); }
              out.set(r.value, got);
              got += r.value.length;
              return pump();
            });
          };
          return pump().then(function () {
            if (tooBig || got !== size) throw damaged();
            return out;
          }, function (err) {
            if (err && err.zipDamaged) throw err;
            // The stream failed (damaged data, or an old decoder): try the built-in one.
            return inflateRaw(data, size);
          });
        }
      }
      return Promise.resolve().then(function () { return inflateRaw(data, size); });
    }

    /* CRC-32, to check each file came out of the zip unchanged. */
    var CRC_TABLE = null;
    function crc32(bytes) {
      if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
          var c = n;
          for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          CRC_TABLE[n] = c >>> 0;
        }
      }
      var crc = 0xffffffff;
      for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    }

    /* ------------------------------ Zip reader ------------------------------ */

    /* The zip's file list: [{ name, method, size, csize, offset }]. */
    function zipEntries(bytes) {
      var bad = function (why) { return new Error("This .zip can't be read" + (why ? " (" + why + ")" : "") + ". Make it again with your system's Compress or Send to → Compressed folder."); };
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var end = -1;
      for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
      }
      if (end === -1) throw bad("it isn't a zip file, or it's incomplete");
      var count = view.getUint16(end + 10, true), cdSize = view.getUint32(end + 12, true), cdOff = view.getUint32(end + 16, true);
      if (count === 0xffff || cdOff === 0xffffffff) throw bad("it's in the large ZIP64 format");
      if (cdOff + cdSize > bytes.length) throw bad("it's incomplete");
      var utf8 = new TextDecoder("utf-8");
      var out = [], p = cdOff;
      for (var n = 0; n < count; n++) {
        if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw bad("its file list is damaged");
        var flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
        var crc = view.getUint32(p + 16, true);
        var csize = view.getUint32(p + 20, true), size = view.getUint32(p + 24, true);
        var nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
        var local = view.getUint32(p + 42, true);
        if (p + 46 + nameLen + extraLen + commentLen > cdOff + cdSize) throw bad("its file list is damaged");
        var name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        if (flags & 1) throw bad("it's password-protected");
        if (local + 30 > cdOff) throw bad("its file list is damaged");
        out.push({ name: name, method: method, flags: flags, crc: crc, size: size, csize: csize, offset: local });
        p += 46 + nameLen + extraLen + commentLen;
      }
      return out;
    }

    function zipRead(bytes, entry) {
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var p = entry.offset;
      if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50) return Promise.reject(new Error("\"" + entry.name + "\" in the .zip is damaged."));
      var damagedErr = function () { return new Error("\"" + entry.name + "\" in the .zip is damaged. Make the zip again."); };
      // The file's own header has to agree with the file list.
      if (view.getUint16(p + 8, true) !== entry.method || (view.getUint16(p + 6, true) & 1)) return Promise.reject(damagedErr());
      var start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
      var data = bytes.subarray(start, start + entry.csize);
      if (data.length !== entry.csize) return Promise.reject(new Error("\"" + entry.name + "\" in the .zip is cut short."));
      var out;
      if (entry.method === 0) out = data.length === entry.size ? Promise.resolve(data) : Promise.reject(damagedErr());
      else if (entry.method === 8) out = inflateEntry(data, entry.size);
      else return Promise.reject(new Error("\"" + entry.name + "\" in the .zip uses a compression method this app can't open. Make the zip with your system's built-in Compress option."));
      return out.then(function (d) {
        if (crc32(d) !== entry.crc) throw damagedErr();
        return d;
      }, function () { throw damagedErr(); });
    }

    /* ------------------------------ Images ------------------------------ */

    function bytesToBase64(bytes) {
      var parts = [];
      for (var i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
      return btoa(parts.join(""));
    }


    // Some Windows tools store "unit\Img.Q1.png": both slashes separate folders.
    function baseName(path) { return path.split(/[\\/]/).pop(); }
    function zipJunk(path) { return /(^|[\\/])__MACOSX[\\/]/.test(path) || /^\./.test(baseName(path)) || /[\\/]$/.test(path); }




    /* Unit files are UTF-8. Bytes that aren't valid UTF-8 are refused rather
       than quietly turned into replacement marks in questions and answers. */
    function decodeUnitBytes(bytes, name) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
      } catch (err) {
        throw new Error("\"" + name + "\" isn't saved as UTF-8 text. In your editor, use Save As and pick UTF-8, then load it again.", { cause: err });
      }
    }

    /* Everything a zip holds, checked against the limits in opts:
       { text, textName, images: [{ n, name, type, b64 }] }. */
    function extract(bytes, opts) {
      var nameRe = new RegExp(opts.nameRe, "i");
      if (bytes.length > opts.maxZip) return Promise.reject(new Error("This .zip is too large (the limit is 40 MB)."));
      var entries;
      try { entries = zipEntries(bytes); } catch (err) { return Promise.reject(err); }
      entries = entries.filter(function (e) { return !zipJunk(e.name); });
      var texts = entries.filter(function (e) { return /\.txt$/i.test(e.name); });
      if (!texts.length) return Promise.reject(new Error("There's no unit file (.txt) in this .zip."));
      if (texts.length > 1) return Promise.reject(new Error("This .zip has " + texts.length + " .txt files (" + texts.map(function (e) { return baseName(e.name); }).slice(0, 4).join(", ") + "). Put exactly one unit file in it."));
      var images = [], seen = {}, total = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], base = baseName(e.name), m = base.match(nameRe);
        if (!m) {
          if (/^img\.q/i.test(base)) return Promise.reject(new Error("\"" + base + "\" isn't named like Img.Q3.png: Img, a dot, Q and the question number, then the extension."));
          continue;
        }
        var type = opts.types[m[2].toLowerCase()];
        if (!type) return Promise.reject(new Error("\"" + base + "\" isn't a supported picture. Use .png, .jpg, .gif, .webp, .svg or .bmp."));
        var n = Number(m[1]);
        if (!(n >= 1)) return Promise.reject(new Error("\"" + base + "\": question numbers start at 1."));
        if (seen[n]) return Promise.reject(new Error("Question " + n + " has two images (" + seen[n] + " and " + base + ")."));
        if (e.size > opts.maxImage) return Promise.reject(new Error("\"" + base + "\" is too large (the limit is 8 MB per image)."));
        total += e.size;
        if (total > opts.maxImagesTotal) return Promise.reject(new Error("The images in this .zip add up to more than 25 MB. Make them smaller."));
        seen[n] = base;
        images.push({ entry: e, n: n, name: "Img.Q" + n + "." + m[2].toLowerCase(), type: type });
      }
      if (texts[0].size > opts.maxText) return Promise.reject(new Error("The unit file in this .zip is too large (the limit is 40 MB)."));
      var out = { textName: baseName(texts[0].name), text: "", images: [] };
      return zipRead(bytes, texts[0]).then(function (raw) {
        out.text = decodeUnitBytes(raw, out.textName);
        return images.reduce(function (chain, im) {
          return chain.then(function () { return zipRead(bytes, im.entry); }).then(function (data) {
            var b64 = bytesToBase64(data);
            // The picture's id (see imageId) is worked out here too, off the page,
            // when hashText is at hand (the worker is given a copy).
            var id = typeof hashText === "function" ? hashText("data:" + im.type + ";base64," + b64) : undefined;
            // The raw bytes too: the page shows and measures the picture from
            // them directly, instead of decoding the base64 again.
            out.images.push({ n: im.n, name: im.name, type: im.type, b64: b64, id: id, bytes: data });
          });
        }, Promise.resolve());
      }).then(function () { return out; });
    }

    return { extract: extract, inflateRaw: inflateRaw, inflateEntry: inflateEntry, decodeUnitBytes: decodeUnitBytes };
  }

  var zipKit = makeZipKit();
  function inflateRaw(src, size) { return zipKit.inflateRaw(src, size); }
  function inflateEntry(data, size) { return zipKit.inflateEntry(data, size); }
  function decodeUnitBytes(bytes, name) { return zipKit.decodeUnitBytes(bytes, name); }

  /* Unpack in a worker made from makeZipKit's own source; if a worker
     can't start (or is blocked), unpack here instead. */
  var zipWorkerUrl = null, zipWorkerBroken = false;
  function extractZip(bytes, opts) {
    if (zipWorkerBroken || typeof Worker !== "function") return zipKit.extract(bytes, opts);
    return new Promise(function (resolve, reject) {
      var w, settled = false;
      var here = function () { zipWorkerBroken = true; if (w) w.terminate(); resolve(zipKit.extract(bytes, opts)); };
      try {
        if (!zipWorkerUrl) {
          var src = hashText.toString() + "\nvar kit = (" + makeZipKit.toString() + ")();\n" +
            // The pictures' bytes are moved to the page, not copied.
            "onmessage = function (e) { kit.extract(e.data.bytes, e.data.opts).then(function (r) {" +
            " var moved = []; r.images.forEach(function (im) { if (moved.indexOf(im.bytes.buffer) === -1) moved.push(im.bytes.buffer); });" +
            " postMessage({ ok: r }, moved); }, function (err) { postMessage({ error: err && err.message || String(err) }); }); };";
          zipWorkerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        }
        w = new Worker(zipWorkerUrl);
      } catch (err) { here(); return; }
      w.onmessage = function (e) {
        settled = true;
        w.terminate();
        if (e.data && e.data.error) reject(new Error(e.data.error)); else resolve(e.data.ok);
      };
      w.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); if (!settled) here(); };
      // A copy: the bytes are still needed here if the worker fails.
      w.postMessage({ bytes: bytes, opts: opts });
    });
  }

  /* Load the picture to check it really is one and learn its shape (a
     hotspot's leeway is a circle, so it needs the height-to-width ratio). */
  function measureImage(src, name) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var timer = setTimeout(function () { reject(new Error("\"" + name + "\" took too long to open. Try a smaller picture.")); }, IMAGE_MEASURE_MS);
      img.onload = function () {
        clearTimeout(timer);
        var w = img.naturalWidth, h = img.naturalHeight;
        // An SVG without a size has none; a hotspot needs a real shape.
        if (!(w > 0 && h > 0)) { reject(new Error("\"" + name + "\" has no size. Give the SVG a width and height, or use a .png.")); return; }
        if (w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE || w * h > MAX_IMAGE_PIXELS) {
          reject(new Error("\"" + name + "\" is " + w + "×" + h + " pixels, which is too large. Make it smaller (at most " + MAX_IMAGE_SIDE + " pixels a side and 40 megapixels)."));
          return;
        }
        resolve({ width: w, height: h });
      };
      img.onerror = function () { clearTimeout(timer); reject(new Error("\"" + name + "\" isn't a picture this app can show.")); };
      img.src = src;
    });
  }

  /* Measure pictures a few at a time (all at once could decode dozens of
     big pictures together; one at a time is slow). */
  function measureAll(list, limit) {
    var i = 0, out = {}, made = [], failed = false;
    var next = function () {
      // One picture failed: the others stop, and nothing more is made.
      if (failed || i >= list.length) return Promise.resolve();
      var im = list[i++], src = "data:" + im.type + ";base64," + im.b64;
      // From the raw bytes when there are any: one Blob, used to measure the
      // picture now and to show it later (see seedImageUrls).
      var blobUrl = im.bytes && typeof Blob === "function" ? URL.createObjectURL(new Blob([im.bytes], { type: im.type })) : null;
      if (blobUrl) made.push(blobUrl);
      return measureImage(blobUrl || src, im.name).then(function (dim) {
        rememberChecked(src, dim);
        out[im.n] = { name: im.name, src: src, id: im.id, width: dim.width, height: dim.height, blobUrl: blobUrl };
        return next();
      });
    };
    var runners = [];
    for (var k = 0; k < Math.min(limit, list.length); k++) runners.push(next());
    var settled = runners.map(function (r) { return r.then(function () { return null; }, function (err) { failed = true; return err; }); });
    return Promise.all(settled).then(function (errs) {
      var err = errs.filter(Boolean)[0];
      if (!err) return out;
      // The .zip is refused: let go of every picture made for it.
      made.forEach(function (u) { URL.revokeObjectURL(u); });
      throw err;
    });
  }

  /* Pictures already written into a bank's text (a .txt, a .zip's unit
     file, a saved bank, a saved session) get the same checks as loose ones
     from a .zip: each really is a picture, of the size the bank says it is
     (a hotspot's circle depends on that shape), within the size limits,
     and all of them together within the total. A picture that passed once
     isn't decoded again this session. Pictures in the desktop app's own
     store ("asset:") were checked when they were stored. */
  // src -> its measured size: a later bank with the same picture still has
  // its stated size compared, without decoding the picture again.
  var checkedPictures = new Map(), checkedChars = 0;
  function rememberChecked(src, dim) {
    // Kept within bounds: past ~100 MB of picture text, start again.
    if (checkedChars + src.length > 100 * 1024 * 1024) { checkedPictures.clear(); checkedChars = 0; }
    if (!checkedPictures.has(src)) checkedChars += src.length;
    checkedPictures.set(src, { width: dim.width, height: dim.height });
  }
  /* Sizes are written as whole pixels; a big picture may be a pixel off
     (an SVG with a fractional size rounds differently between browsers),
     a small one must match exactly, since a pixel changes its shape. */
  function sizeMatches(dim, im) {
    var near = function (a, b) { return a === b || (Math.abs(a - b) <= 1 && a >= 100); };
    return near(dim.width, im.width) && near(dim.height, im.height);
  }
  function sizeError(dim, im) {
    return new Error("\"" + im.name + "\" is " + dim.width + "×" + dim.height + " pixels, but this bank says " + im.width + "×" + im.height + ". Load the original .zip again.");
  }
  function inlinePictureBytes(src) {
    var b64 = src.slice(src.indexOf(",") + 1);
    return Math.floor(b64.length * 3 / 4) - (/==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0);
  }
  function checkBankImages(images) {
    var list = [], total = 0, err = null;
    Object.keys(images || {}).forEach(function (n) {
      var im = images[n];
      if (err || im.src.indexOf("data:") !== 0) return;
      var size = inlinePictureBytes(im.src);
      total += size;
      var known = checkedPictures.get(im.src);
      if (size > MAX_IMAGE_BYTES) err = new Error("\"" + im.name + "\" is larger than 8 MB. Make it smaller and load the .zip again.");
      else if (!known) list.push(im);
      else if (!sizeMatches(known, im)) err = sizeError(known, im);
    });
    if (!err && total > MAX_IMAGES_TOTAL) err = new Error("This bank's pictures add up to more than 25 MB. Make them smaller and load the .zip again.");
    var tagged = function (e) { if (e && typeof e === "object") e.picture = true; throw e; };
    if (err) return Promise.reject(err).catch(tagged);
    var i = 0, failed = false;
    var next = function () {
      if (failed || i >= list.length) return Promise.resolve();
      var im = list[i++];
      return measureImage(im.src, im.name).then(function (dim) {
        rememberChecked(im.src, dim);
        if (!sizeMatches(dim, im)) throw sizeError(dim, im);
        return next();
      });
    };
    var runners = [];
    for (var k = 0; k < Math.min(4, list.length); k++) runners.push(next().catch(function (e) { failed = true; throw e; }));
    return Promise.all(runners).then(function () {}, tagged);
  }
  /* The bank text, once its pictures pass checkBankImages. Text that
     doesn't parse is passed on, for loadUnitText to explain. */
  function checkedBankText(text) {
    var split;
    try { split = splitImageSection(text); } catch (err) { return Promise.resolve(text); }
    return checkBankImages(split.images).then(function () { return text; });
  }

  /* A zip's bytes → the bank's text with its images attached. */
  function unitTextFromZip(bytes) {
    if (bytes.length > MAX_ZIP_BYTES) return Promise.reject(new Error("This .zip is too large (the limit is 40 MB)."));
    var opts = { maxZip: MAX_ZIP_BYTES, maxImage: MAX_IMAGE_BYTES, maxImagesTotal: MAX_IMAGES_TOTAL, maxText: MAX_BUNDLE_BYTES,
      types: IMAGE_TYPES, nameRe: IMAGE_NAME_RE.source };
    return extractZip(bytes, opts).then(function (r) {
      // A saved bank zipped up again keeps its pictures; loose Img.Q files
      // in the zip replace those questions' pictures only.
      var split = splitImageSection(r.text);
      var text = split.text;
      if (utf8Bytes(text) > MAX_BANK_BYTES) throw new Error("The unit file in this .zip is too large (the limit is 5 MB of text).");
      return measureAll(r.images, 4).then(function (loose) {
        var result = {}, urls = [];
        Object.keys(split.images).forEach(function (n) { result[n] = split.images[n]; });
        Object.keys(loose).forEach(function (n) { result[n] = loose[n]; urls.push({ src: loose[n].src, url: loose[n].blobUrl }); });
        urls = urls.filter(function (u) { return u.url; });
        // The pictures kept from the unit file are checked too, and every
        // picture counts toward the total.
        return checkBankImages(result).then(function () {
          var bundled = bundleImages(text, result);
          if (utf8Bytes(bundled) > MAX_BUNDLE_BYTES) throw new Error("This bank and its pictures add up to more than 40 MB. Make the pictures smaller.");
          return { text: bundled, count: Object.keys(result).length, urls: urls };
        }).catch(function (err) { dropBlobUrls(urls); throw err; });
      });
    });
  }

  function loadUnitZip(bytes, token) {
    return unitTextFromZip(bytes).then(function (r) {
      if (token !== undefined && !isLatestImport(token)) { dropBlobUrls(r.urls); return { ok: false }; }
      var res = loadUnitText(r.text);
      // After loading: opening a bank lets go of the previous bank's URLs.
      if (res.ok) seedImageUrls(r.urls); else dropBlobUrls(r.urls);
      if (res.ok && r.count) notify("Loaded " + r.count + (r.count === 1 ? " image." : " images."));
      return res;
    }, function (err) {
      if (token === undefined || isLatestImport(token)) setLandingError(err.message);
      return { ok: false, error: err.message };
    });
  }

  function isZipName(name) { return /\.zip$/i.test(String(name || "")); }

  /* ------------------------- Question pictures -------------------------
     A question with an image shows it beside the question text; a hotspot
     question shows the question above a larger image you click on. Both
     live in a "question box": #<prefix>-qbox holding the text and the
     #<prefix>-figure. */

  /* Pictures are shown through Blob URLs, made once per picture and
     shared by every element showing it, instead of copying a long data URL
     into each one. A picture kept in the desktop app's picture folder
     ("asset:...") is fetched the first time it's needed. The URLs are let
     go when another bank is opened. */
  var imageUrls = new Map(); // src -> Promise of a URL
  /* Pictures just measured from a .zip already have a Blob URL: use it. */
  function seedImageUrls(urls) {
    (urls || []).forEach(function (u) {
      if (imageUrls.has(u.src)) URL.revokeObjectURL(u.url);
      else imageUrls.set(u.src, Promise.resolve(u.url));
    });
  }
  function dropBlobUrls(urls) {
    (urls || []).forEach(function (u) { URL.revokeObjectURL(u.url); });
  }
  var ASSET_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };
  function imageUrl(src) {
    var hit = imageUrls.get(src);
    if (hit) return hit;
    var made;
    if (src.indexOf("asset:") === 0) {
      var name = src.slice(6), type = ASSET_TYPES[name.split(".").pop()];
      made = desktopCall("read_image", { name: name }).then(function (buf) {
        return URL.createObjectURL(new Blob([buf], { type: type }));
      });
    } else {
      // The browser decodes the data URL itself (off the page); by hand if it can't.
      var byHand = function () {
        var comma = src.indexOf(","), bin = atob(src.slice(comma + 1)), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: src.slice(5, src.indexOf(";")) });
      };
      made = (typeof fetch === "function" ? fetch(src).then(function (r) { return r.blob(); }).catch(byHand) : Promise.resolve().then(byHand))
        .then(function (blob) { return URL.createObjectURL(blob); });
    }
    // A failed fetch can be tried again later.
    made = made.catch(function (err) { if (imageUrls.get(src) === made) imageUrls.delete(src); throw err; });
    imageUrls.set(src, made);
    return made;
  }
  function releaseImageUrls() {
    imageUrls.forEach(function (p) { p.then(function (u) { URL.revokeObjectURL(u); }, function () {}); });
    imageUrls.clear();
    // Pictures still waiting belong to lists that are gone now.
    if (nearView) { nearView.disconnect(); nearView = null; }
  }

  /* Long lists (Home, the review page, missed questions) fetch a picture
     only once it comes within a screen or so of view: building its Blob
     URL means decoding the data or, in the desktop app, reading the file,
     which for hundreds of rows is wasted work if nobody scrolls there. */
  var nearView = null;
  /* A list being rebuilt: its old pictures aren't waited for any more. */
  function forgetNearView(container) {
    if (!nearView || !container) return;
    Array.prototype.forEach.call(container.querySelectorAll("img"), function (img) {
      if (img.__whenNear) { img.__whenNear = null; nearView.unobserve(img); }
    });
  }
  function whenNearView(el, fn) {
    if (typeof IntersectionObserver !== "function") { fn(); return; }
    if (!nearView) {
      nearView = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          nearView.unobserve(e.target);
          var go = e.target.__whenNear;
          e.target.__whenNear = null;
          if (go) go();
        });
      }, { rootMargin: "800px 0px" });
    }
    el.__whenNear = fn;
    nearView.observe(el);
  }

  /* lazy: the picture is in a long list (see whenNearView). Pictures on the
     question being answered load straight away. */
  function questionImage(question, cls, lazy) {
    var img = document.createElement("img");
    img.className = cls || "q-img";
    img.alt = "Picture for this question";
    img.draggable = false;
    img.decoding = "async";
    var missing = function () {
      img.alt = "This picture couldn't be loaded";
      img.classList.add("img-missing");
    };
    // A picture that's fetched but can't be shown is marked the same way.
    img.addEventListener("error", missing);
    var load = function () {
      imageUrl(question.image).then(function (u) { img.src = u; }, missing);
    };
    if (lazy) { img.loading = "lazy"; whenNearView(img, load); } else load();
    return img;
  }

  /* A hidden live region for screen-reader announcements. */
  function srStatus() {
    var el = byId("sr-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "sr-status";
      el.className = "sr-only";
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }

  /* opts: { pick: {x, y} | null, onPick(x, y), locked, reveal: bool, lazy }
     reveal shows the hotspot's circle (green when the pick is on it); lazy
     is for a pad in a long list (see questionImage). */
  function hotspotPad(question, opts) {
    opts = opts || {};
    var pad = document.createElement("div");
    pad.className = "hs-pad";
    pad.tabIndex = 0;
    pad.setAttribute("role", "button");
    pad.setAttribute("aria-label", "Picture: click the spot that answers the question, or press Enter for a cursor, move it with the arrow keys and press Enter to pick");
    pad.appendChild(questionImage(question, "hs-img", opts.lazy));
    var target = document.createElement("span");
    target.className = "hs-target hidden";
    pad.appendChild(target);
    var marker = document.createElement("span");
    marker.className = "hs-marker hidden";
    pad.appendChild(marker);
    var api = { el: pad, pick: opts.pick || null, locked: !!opts.locked, cursor: null };
    var place = function (el, p) {
      el.style.left = p.x + "%";
      el.style.top = p.y + "%";
    };
    // Screen readers hear where the keyboard cursor is (a picture can't be
    // described any other way). One shared region, outside the pad: the
    // contents of a role="button" element aren't always announced.
    var said = opts.locked ? null : srStatus();
    var sayCursor = function (p) {
      if (said) said.textContent = "Cursor " + Math.round(p.x) + "% across, " + Math.round(p.y) + "% down. Enter picks this spot.";
    };
    api.setPick = function (p) {
      api.pick = p;
      marker.classList.toggle("hidden", !p);
      marker.classList.remove("cursor");
      if (p) place(marker, p);
    };
    api.reveal = function () {
      var h = question.hotspot;
      target.classList.remove("hidden");
      place(target, h);
      target.style.width = (2 * h.r) + "%";
      var hit = !!api.pick && hotspotHit(question, api.pick.x, api.pick.y);
      target.classList.toggle("hit", hit);
      marker.classList.toggle("miss", !!api.pick && !hit);
      pad.classList.add("revealed");
    };
    api.lock = function () { api.locked = true; pad.classList.add("locked"); };
    var choose = function (x, y) {
      if (api.locked) return;
      x = clamp(x, 0, 100); y = clamp(y, 0, 100);
      api.setPick({ x: x, y: y });
      if (opts.onPick) opts.onPick(x, y);
    };
    pad.addEventListener("click", function (event) {
      var img = pad.querySelector("img");
      var r = img.getBoundingClientRect();
      if (!r.width || !r.height) return;
      choose(100 * (event.clientX - r.left) / r.width, 100 * (event.clientY - r.top) / r.height);
    });
    // Keyboard: arrows move a cursor (Shift for fine steps), Enter or Space picks.
    pad.addEventListener("keydown", function (event) {
      // A minigame owns the keys while it's up (its arrows and Space/Enter).
      if (api.locked || (game && game.minigame)) return;
      // Shortcuts with Ctrl, Alt or Cmd aren't the pad's.
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      var k = event.key, step = event.shiftKey ? 0.5 : 2.5;
      var d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      if (d) {
        event.preventDefault();
        event.stopPropagation();
        var c = api.cursor || api.pick || { x: 50, y: 50 };
        api.cursor = { x: clamp(c.x + d[0], 0, 100), y: clamp(c.y + d[1], 0, 100) };
        marker.classList.remove("hidden");
        marker.classList.add("cursor");
        place(marker, api.cursor);
        sayCursor(api.cursor);
      } else if (k === "Enter" || k === " ") {
        event.preventDefault();
        event.stopPropagation();
        // A held key repeats: only a fresh press shows or picks, so holding
        // it can't answer this question (or the next one, which gets focus).
        if (event.repeat) return;
        if (!api.cursor) {
          // No cursor yet: show one in the middle to move from (and don't
          // let Space scroll the page).
          api.cursor = api.pick || { x: 50, y: 50 };
          marker.classList.remove("hidden");
          marker.classList.add("cursor");
          place(marker, api.cursor);
          sayCursor(api.cursor);
          return;
        }
        var cur = api.cursor;
        api.cursor = null;
        choose(cur.x, cur.y);
        // A game can refuse a pick (while fog hides the picture, say).
        if (said) said.textContent = api.pick
          ? "Picked " + Math.round(cur.x) + "% across, " + Math.round(cur.y) + "% down."
          : "That pick wasn't taken. Wait until the picture can be seen.";
      }
    });
    if (api.pick) api.setPick(api.pick);
    if (opts.reveal) api.reveal();
    if (api.locked) api.lock();
    return api;
  }

  /* Fill a question box. Returns the hotspot pad for hotspot questions. */
  function renderQuestionFigure(prefix, question, padOpts) {
    var box = byId(prefix + "-qbox"), fig = byId(prefix + "-figure");
    if (!box || !fig) return null;
    // Redrawing (a pick with instant feedback, the next question) shouldn't
    // make a keyboard user Tab back to the picture.
    var hadFocus = !!(document.activeElement && fig.contains(document.activeElement));
    fig.textContent = "";
    box.classList.remove("with-image", "hotspot");
    var hasImg = !!(question && question.image);
    fig.classList.toggle("hidden", !hasImg);
    if (!hasImg) return null;
    if (question.hotspot) {
      box.classList.add("hotspot");
      var pad = hotspotPad(question, padOpts);
      fig.appendChild(pad.el);
      if (hadFocus) pad.el.focus({ preventScroll: true });
      return pad;
    }
    box.classList.add("with-image");
    fig.appendChild(questionImage(question));
    return null;
  }

  /* The answer side of a hotspot question, for lists and flashcards: the
     picture with the spot circled, and its label if it has one. */
  function hotspotAnswerView(question, small) {
    var wrap = document.createElement("div");
    wrap.className = "hs-answer" + (small ? " small" : "");
    // A small view is a row in a list.
    var pad = hotspotPad(question, { locked: true, reveal: true, lazy: !!small });
    pad.el.tabIndex = -1;
    pad.el.removeAttribute("role");
    pad.el.setAttribute("aria-label", "Picture with the answer circled");
    wrap.appendChild(pad.el);
    if (question.answer) {
      var label = document.createElement("span");
      label.className = "hs-label";
      label.textContent = question.answer;
      wrap.appendChild(label);
    }
    return wrap;
  }
