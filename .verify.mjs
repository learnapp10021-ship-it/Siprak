// scripts/verify.mjs
import fs from "node:fs";
import vm from "node:vm";
import nodeCrypto from "node:crypto";

// node_modules/immer/dist/immer.mjs
var NOTHING = Symbol.for("immer-nothing");
var DRAFTABLE = Symbol.for("immer-draftable");
var DRAFT_STATE = Symbol.for("immer-state");
var errors = process.env.NODE_ENV !== "production" ? [
  // All error codes, starting by 0:
  function(plugin) {
    return `The plugin for '${plugin}' has not been loaded into Immer. To enable the plugin, import and call \`enable${plugin}()\` when initializing your application.`;
  },
  function(thing) {
    return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${thing}'`;
  },
  "This object has been frozen and should not be mutated",
  function(data) {
    return "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + data;
  },
  "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
  "Immer forbids circular references",
  "The first or second argument to `produce` must be a function",
  "The third argument to `produce` must be a function or undefined",
  "First argument to `createDraft` must be a plain object, an array, or an immerable object",
  "First argument to `finishDraft` must be a draft returned by `createDraft`",
  function(thing) {
    return `'current' expects a draft, got: ${thing}`;
  },
  "Object.defineProperty() cannot be used on an Immer draft",
  "Object.setPrototypeOf() cannot be used on an Immer draft",
  "Immer only supports deleting array indices",
  "Immer only supports setting array indices and the 'length' property",
  function(thing) {
    return `'original' expects a draft, got: ${thing}`;
  }
  // Note: if more errors are added, the errorOffset in Patches.ts should be increased
  // See Patches.ts for additional errors
] : [];
function die(error, ...args) {
  if (process.env.NODE_ENV !== "production") {
    const e = errors[error];
    const msg = typeof e === "function" ? e.apply(null, args) : e;
    throw new Error(`[Immer] ${msg}`);
  }
  throw new Error(
    `[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`
  );
}
var getPrototypeOf = Object.getPrototypeOf;
function isDraft(value) {
  return !!value && !!value[DRAFT_STATE];
}
function isDraftable(value) {
  if (!value)
    return false;
  return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
}
var objectCtorString = Object.prototype.constructor.toString();
var cachedCtorStrings = /* @__PURE__ */ new WeakMap();
function isPlainObject(value) {
  if (!value || typeof value !== "object")
    return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null || proto === Object.prototype)
    return true;
  const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  if (Ctor === Object)
    return true;
  if (typeof Ctor !== "function")
    return false;
  let ctorString = cachedCtorStrings.get(Ctor);
  if (ctorString === void 0) {
    ctorString = Function.toString.call(Ctor);
    cachedCtorStrings.set(Ctor, ctorString);
  }
  return ctorString === objectCtorString;
}
function each(obj, iter, strict = true) {
  if (getArchtype(obj) === 0) {
    const keys = strict ? Reflect.ownKeys(obj) : Object.keys(obj);
    keys.forEach((key) => {
      iter(key, obj[key], obj);
    });
  } else {
    obj.forEach((entry, index) => iter(index, entry, obj));
  }
}
function getArchtype(thing) {
  const state = thing[DRAFT_STATE];
  return state ? state.type_ : Array.isArray(thing) ? 1 : isMap(thing) ? 2 : isSet(thing) ? 3 : 0;
}
function has(thing, prop) {
  return getArchtype(thing) === 2 ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
}
function set(thing, propOrOldValue, value) {
  const t = getArchtype(thing);
  if (t === 2)
    thing.set(propOrOldValue, value);
  else if (t === 3) {
    thing.add(value);
  } else
    thing[propOrOldValue] = value;
}
function is(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}
function isMap(target) {
  return target instanceof Map;
}
function isSet(target) {
  return target instanceof Set;
}
function latest(state) {
  return state.copy_ || state.base_;
}
function shallowCopy(base, strict) {
  if (isMap(base)) {
    return new Map(base);
  }
  if (isSet(base)) {
    return new Set(base);
  }
  if (Array.isArray(base))
    return Array.prototype.slice.call(base);
  const isPlain = isPlainObject(base);
  if (strict === true || strict === "class_only" && !isPlain) {
    const descriptors = Object.getOwnPropertyDescriptors(base);
    delete descriptors[DRAFT_STATE];
    let keys = Reflect.ownKeys(descriptors);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const desc = descriptors[key];
      if (desc.writable === false) {
        desc.writable = true;
        desc.configurable = true;
      }
      if (desc.get || desc.set)
        descriptors[key] = {
          configurable: true,
          writable: true,
          // could live with !!desc.set as well here...
          enumerable: desc.enumerable,
          value: base[key]
        };
    }
    return Object.create(getPrototypeOf(base), descriptors);
  } else {
    const proto = getPrototypeOf(base);
    if (proto !== null && isPlain) {
      return { ...base };
    }
    const obj = Object.create(proto);
    return Object.assign(obj, base);
  }
}
function freeze(obj, deep = false) {
  if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj))
    return obj;
  if (getArchtype(obj) > 1) {
    Object.defineProperties(obj, {
      set: dontMutateMethodOverride,
      add: dontMutateMethodOverride,
      clear: dontMutateMethodOverride,
      delete: dontMutateMethodOverride
    });
  }
  Object.freeze(obj);
  if (deep)
    Object.values(obj).forEach((value) => freeze(value, true));
  return obj;
}
function dontMutateFrozenCollections() {
  die(2);
}
var dontMutateMethodOverride = {
  value: dontMutateFrozenCollections
};
function isFrozen(obj) {
  if (obj === null || typeof obj !== "object")
    return true;
  return Object.isFrozen(obj);
}
var plugins = {};
function getPlugin(pluginKey) {
  const plugin = plugins[pluginKey];
  if (!plugin) {
    die(0, pluginKey);
  }
  return plugin;
}
var currentScope;
function getCurrentScope() {
  return currentScope;
}
function createScope(parent_, immer_) {
  return {
    drafts_: [],
    parent_,
    immer_,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: true,
    unfinalizedDrafts_: 0
  };
}
function usePatchesInScope(scope, patchListener) {
  if (patchListener) {
    getPlugin("Patches");
    scope.patches_ = [];
    scope.inversePatches_ = [];
    scope.patchListener_ = patchListener;
  }
}
function revokeScope(scope) {
  leaveScope(scope);
  scope.drafts_.forEach(revokeDraft);
  scope.drafts_ = null;
}
function leaveScope(scope) {
  if (scope === currentScope) {
    currentScope = scope.parent_;
  }
}
function enterScope(immer2) {
  return currentScope = createScope(currentScope, immer2);
}
function revokeDraft(draft) {
  const state = draft[DRAFT_STATE];
  if (state.type_ === 0 || state.type_ === 1)
    state.revoke_();
  else
    state.revoked_ = true;
}
function processResult(result, scope) {
  scope.unfinalizedDrafts_ = scope.drafts_.length;
  const baseDraft = scope.drafts_[0];
  const isReplaced = result !== void 0 && result !== baseDraft;
  if (isReplaced) {
    if (baseDraft[DRAFT_STATE].modified_) {
      revokeScope(scope);
      die(4);
    }
    if (isDraftable(result)) {
      result = finalize(scope, result);
      if (!scope.parent_)
        maybeFreeze(scope, result);
    }
    if (scope.patches_) {
      getPlugin("Patches").generateReplacementPatches_(
        baseDraft[DRAFT_STATE].base_,
        result,
        scope.patches_,
        scope.inversePatches_
      );
    }
  } else {
    result = finalize(scope, baseDraft, []);
  }
  revokeScope(scope);
  if (scope.patches_) {
    scope.patchListener_(scope.patches_, scope.inversePatches_);
  }
  return result !== NOTHING ? result : void 0;
}
function finalize(rootScope, value, path) {
  if (isFrozen(value))
    return value;
  const useStrictIteration = rootScope.immer_.shouldUseStrictIteration();
  const state = value[DRAFT_STATE];
  if (!state) {
    each(
      value,
      (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path),
      useStrictIteration
    );
    return value;
  }
  if (state.scope_ !== rootScope)
    return value;
  if (!state.modified_) {
    maybeFreeze(rootScope, state.base_, true);
    return state.base_;
  }
  if (!state.finalized_) {
    state.finalized_ = true;
    state.scope_.unfinalizedDrafts_--;
    const result = state.copy_;
    let resultEach = result;
    let isSet2 = false;
    if (state.type_ === 3) {
      resultEach = new Set(result);
      result.clear();
      isSet2 = true;
    }
    each(
      resultEach,
      (key, childValue) => finalizeProperty(
        rootScope,
        state,
        result,
        key,
        childValue,
        path,
        isSet2
      ),
      useStrictIteration
    );
    maybeFreeze(rootScope, result, false);
    if (path && rootScope.patches_) {
      getPlugin("Patches").generatePatches_(
        state,
        path,
        rootScope.patches_,
        rootScope.inversePatches_
      );
    }
  }
  return state.copy_;
}
function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
  if (childValue == null) {
    return;
  }
  if (typeof childValue !== "object" && !targetIsSet) {
    return;
  }
  const childIsFrozen = isFrozen(childValue);
  if (childIsFrozen && !targetIsSet) {
    return;
  }
  if (process.env.NODE_ENV !== "production" && childValue === targetObject)
    die(5);
  if (isDraft(childValue)) {
    const path = rootPath && parentState && parentState.type_ !== 3 && // Set objects are atomic since they have no keys.
    !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0;
    const res = finalize(rootScope, childValue, path);
    set(targetObject, prop, res);
    if (isDraft(res)) {
      rootScope.canAutoFreeze_ = false;
    } else
      return;
  } else if (targetIsSet) {
    targetObject.add(childValue);
  }
  if (isDraftable(childValue) && !childIsFrozen) {
    if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
      return;
    }
    if (parentState && parentState.base_ && parentState.base_[prop] === childValue && childIsFrozen) {
      return;
    }
    finalize(rootScope, childValue);
    if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && (isMap(targetObject) ? targetObject.has(prop) : Object.prototype.propertyIsEnumerable.call(targetObject, prop)))
      maybeFreeze(rootScope, childValue);
  }
}
function maybeFreeze(scope, value, deep = false) {
  if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
    freeze(value, deep);
  }
}
function createProxyProxy(base, parent) {
  const isArray = Array.isArray(base);
  const state = {
    type_: isArray ? 1 : 0,
    // Track which produce call this is associated with.
    scope_: parent ? parent.scope_ : getCurrentScope(),
    // True for both shallow and deep changes.
    modified_: false,
    // Used during finalization.
    finalized_: false,
    // Track which properties have been assigned (true) or deleted (false).
    assigned_: {},
    // The parent draft state.
    parent_: parent,
    // The base state.
    base_: base,
    // The base proxy.
    draft_: null,
    // set below
    // The base copy with any updated values.
    copy_: null,
    // Called by the `produce` function.
    revoke_: null,
    isManual_: false
  };
  let target = state;
  let traps = objectTraps;
  if (isArray) {
    target = [state];
    traps = arrayTraps;
  }
  const { revoke, proxy } = Proxy.revocable(target, traps);
  state.draft_ = proxy;
  state.revoke_ = revoke;
  return proxy;
}
var objectTraps = {
  get(state, prop) {
    if (prop === DRAFT_STATE)
      return state;
    const source = latest(state);
    if (!has(source, prop)) {
      return readPropFromProto(state, source, prop);
    }
    const value = source[prop];
    if (state.finalized_ || !isDraftable(value)) {
      return value;
    }
    if (value === peek(state.base_, prop)) {
      prepareCopy(state);
      return state.copy_[prop] = createProxy(value, state);
    }
    return value;
  },
  has(state, prop) {
    return prop in latest(state);
  },
  ownKeys(state) {
    return Reflect.ownKeys(latest(state));
  },
  set(state, prop, value) {
    const desc = getDescriptorFromProto(latest(state), prop);
    if (desc?.set) {
      desc.set.call(state.draft_, value);
      return true;
    }
    if (!state.modified_) {
      const current2 = peek(latest(state), prop);
      const currentState = current2?.[DRAFT_STATE];
      if (currentState && currentState.base_ === value) {
        state.copy_[prop] = value;
        state.assigned_[prop] = false;
        return true;
      }
      if (is(value, current2) && (value !== void 0 || has(state.base_, prop)))
        return true;
      prepareCopy(state);
      markChanged(state);
    }
    if (state.copy_[prop] === value && // special case: handle new props with value 'undefined'
    (value !== void 0 || prop in state.copy_) || // special case: NaN
    Number.isNaN(value) && Number.isNaN(state.copy_[prop]))
      return true;
    state.copy_[prop] = value;
    state.assigned_[prop] = true;
    return true;
  },
  deleteProperty(state, prop) {
    if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
      state.assigned_[prop] = false;
      prepareCopy(state);
      markChanged(state);
    } else {
      delete state.assigned_[prop];
    }
    if (state.copy_) {
      delete state.copy_[prop];
    }
    return true;
  },
  // Note: We never coerce `desc.value` into an Immer draft, because we can't make
  // the same guarantee in ES5 mode.
  getOwnPropertyDescriptor(state, prop) {
    const owner = latest(state);
    const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
    if (!desc)
      return desc;
    return {
      writable: true,
      configurable: state.type_ !== 1 || prop !== "length",
      enumerable: desc.enumerable,
      value: owner[prop]
    };
  },
  defineProperty() {
    die(11);
  },
  getPrototypeOf(state) {
    return getPrototypeOf(state.base_);
  },
  setPrototypeOf() {
    die(12);
  }
};
var arrayTraps = {};
each(objectTraps, (key, fn) => {
  arrayTraps[key] = function() {
    arguments[0] = arguments[0][0];
    return fn.apply(this, arguments);
  };
});
arrayTraps.deleteProperty = function(state, prop) {
  if (process.env.NODE_ENV !== "production" && isNaN(parseInt(prop)))
    die(13);
  return arrayTraps.set.call(this, state, prop, void 0);
};
arrayTraps.set = function(state, prop, value) {
  if (process.env.NODE_ENV !== "production" && prop !== "length" && isNaN(parseInt(prop)))
    die(14);
  return objectTraps.set.call(this, state[0], prop, value, state[0]);
};
function peek(draft, prop) {
  const state = draft[DRAFT_STATE];
  const source = state ? latest(state) : draft;
  return source[prop];
}
function readPropFromProto(state, source, prop) {
  const desc = getDescriptorFromProto(source, prop);
  return desc ? `value` in desc ? desc.value : (
    // This is a very special case, if the prop is a getter defined by the
    // prototype, we should invoke it with the draft as context!
    desc.get?.call(state.draft_)
  ) : void 0;
}
function getDescriptorFromProto(source, prop) {
  if (!(prop in source))
    return void 0;
  let proto = getPrototypeOf(source);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc)
      return desc;
    proto = getPrototypeOf(proto);
  }
  return void 0;
}
function markChanged(state) {
  if (!state.modified_) {
    state.modified_ = true;
    if (state.parent_) {
      markChanged(state.parent_);
    }
  }
}
function prepareCopy(state) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(
      state.base_,
      state.scope_.immer_.useStrictShallowCopy_
    );
  }
}
var Immer2 = class {
  constructor(config) {
    this.autoFreeze_ = true;
    this.useStrictShallowCopy_ = false;
    this.useStrictIteration_ = true;
    this.produce = (base, recipe, patchListener) => {
      if (typeof base === "function" && typeof recipe !== "function") {
        const defaultBase = recipe;
        recipe = base;
        const self = this;
        return function curriedProduce(base2 = defaultBase, ...args) {
          return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
        };
      }
      if (typeof recipe !== "function")
        die(6);
      if (patchListener !== void 0 && typeof patchListener !== "function")
        die(7);
      let result;
      if (isDraftable(base)) {
        const scope = enterScope(this);
        const proxy = createProxy(base, void 0);
        let hasError = true;
        try {
          result = recipe(proxy);
          hasError = false;
        } finally {
          if (hasError)
            revokeScope(scope);
          else
            leaveScope(scope);
        }
        usePatchesInScope(scope, patchListener);
        return processResult(result, scope);
      } else if (!base || typeof base !== "object") {
        result = recipe(base);
        if (result === void 0)
          result = base;
        if (result === NOTHING)
          result = void 0;
        if (this.autoFreeze_)
          freeze(result, true);
        if (patchListener) {
          const p = [];
          const ip = [];
          getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
          patchListener(p, ip);
        }
        return result;
      } else
        die(1, base);
    };
    this.produceWithPatches = (base, recipe) => {
      if (typeof base === "function") {
        return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
      }
      let patches, inversePatches;
      const result = this.produce(base, recipe, (p, ip) => {
        patches = p;
        inversePatches = ip;
      });
      return [result, patches, inversePatches];
    };
    if (typeof config?.autoFreeze === "boolean")
      this.setAutoFreeze(config.autoFreeze);
    if (typeof config?.useStrictShallowCopy === "boolean")
      this.setUseStrictShallowCopy(config.useStrictShallowCopy);
    if (typeof config?.useStrictIteration === "boolean")
      this.setUseStrictIteration(config.useStrictIteration);
  }
  createDraft(base) {
    if (!isDraftable(base))
      die(8);
    if (isDraft(base))
      base = current(base);
    const scope = enterScope(this);
    const proxy = createProxy(base, void 0);
    proxy[DRAFT_STATE].isManual_ = true;
    leaveScope(scope);
    return proxy;
  }
  finishDraft(draft, patchListener) {
    const state = draft && draft[DRAFT_STATE];
    if (!state || !state.isManual_)
      die(9);
    const { scope_: scope } = state;
    usePatchesInScope(scope, patchListener);
    return processResult(void 0, scope);
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(value) {
    this.autoFreeze_ = value;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(value) {
    this.useStrictShallowCopy_ = value;
  }
  /**
   * Pass false to use faster iteration that skips non-enumerable properties
   * but still handles symbols for compatibility.
   *
   * By default, strict iteration is enabled (includes all own properties).
   */
  setUseStrictIteration(value) {
    this.useStrictIteration_ = value;
  }
  shouldUseStrictIteration() {
    return this.useStrictIteration_;
  }
  applyPatches(base, patches) {
    let i;
    for (i = patches.length - 1; i >= 0; i--) {
      const patch = patches[i];
      if (patch.path.length === 0 && patch.op === "replace") {
        base = patch.value;
        break;
      }
    }
    if (i > -1) {
      patches = patches.slice(i + 1);
    }
    const applyPatchesImpl = getPlugin("Patches").applyPatches_;
    if (isDraft(base)) {
      return applyPatchesImpl(base, patches);
    }
    return this.produce(
      base,
      (draft) => applyPatchesImpl(draft, patches)
    );
  }
};
function createProxy(value, parent) {
  const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
  const scope = parent ? parent.scope_ : getCurrentScope();
  scope.drafts_.push(draft);
  return draft;
}
function current(value) {
  if (!isDraft(value))
    die(10, value);
  return currentImpl(value);
}
function currentImpl(value) {
  if (!isDraftable(value) || isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  let copy;
  let strict = true;
  if (state) {
    if (!state.modified_)
      return state.base_;
    state.finalized_ = true;
    copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
    strict = state.scope_.immer_.shouldUseStrictIteration();
  } else {
    copy = shallowCopy(value, true);
  }
  each(
    copy,
    (key, childValue) => {
      set(copy, key, currentImpl(childValue));
    },
    strict
  );
  if (state) {
    state.finalized_ = false;
  }
  return copy;
}
var immer = new Immer2();
var produce = immer.produce;

// src/lib/utils.js
var T = (s, k) => s.trim().split("\n").map((l) => Object.fromEntries(l.split("|").map((v, i) => [k[i], v])));
var wa = (s) => {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return /^628\d{8,11}$/.test(d) ? d : "";
};
var pad = (n) => String(n).padStart(2, "0");
var todayStr = () => {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
var nowStr = () => {
  const d = /* @__PURE__ */ new Date();
  return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
var today = todayStr;
var D = (d) => d ? (/* @__PURE__ */ new Date(d.slice(0, 10) + "T00:00:00Z")).toLocaleDateString("id-ID", {
  day: "numeric",
  month: "short",
  timeZone: "UTC"
}) : "belum diisi";
var addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
var sum = (a, f) => Math.round(a.reduce((s, x) => s + (+f(x) || 0), 0) * 1e6) / 1e6;
var isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(Date.parse(s));
var nextId = (rows, prefix, key = "id", width = 3) => prefix + String(rows.reduce((m, r) => Math.max(m, parseInt(String(r[key]).slice(prefix.length), 10) || 0), 0) + 1).padStart(width, "0");

// src/lib/selectors.js
function makeSel(db2) {
  const { U, M, R, I, K, L, KD, SR, RM } = db2;
  const user = (id) => U.find((u) => u.id == id);
  const nm = (id) => user(id)?.n || id;
  const uid = (v) => (user(v) || U.find((u) => u.n == v))?.id || v;
  const mi = (k) => M.find((m) => m.k == k);
  const KN = (id) => K.find((k) => k.id == id);
  const RQ = (id) => R.find((r) => r.id == id);
  const SRLof = (no) => L.find((l) => l.no == no);
  const live = (i) => !["Ditolak", "Dibatalkan"].includes(i.status);
  const total = (k) => sum(I.filter((i) => i.kon == k.id && live(i)), (i) => i.qty);
  const datang = (k) => sum(KD.filter((d) => d.kon == k.id), (d) => d.qty);
  const sisa = (k) => Math.max(0, total(k) - datang(k) - +k.tutup);
  const ord = (a, b) => {
    const pa = a.pakai || "9", pb = b.pakai || "9";
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.appr !== b.appr) return a.appr < b.appr ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const berhak = (it) => {
    const k = KN(it.kon);
    if (!k) return 0;
    let r = datang(k);
    for (const x of I.filter((i) => i.kon == k.id && live(i)).sort(ord)) {
      const g = Math.min(r, +x.qty);
      if (x.id == it.id) return g;
      r -= g;
    }
    return 0;
  };
  const diambil = (it) => sum(SR.filter((s) => s.item == it.id), (s) => s.qty);
  const siap = (it) => berhak(it) - diambil(it);
  const deptOf = (it) => user(RQ(it.req)?.by)?.dept;
  const lastArrival = (kon) => KD.filter((d) => d.kon == kon).map((d) => d.tgl).sort().pop();
  const firstArrival = (kon) => KD.filter((d) => d.kon == kon).map((d) => d.tgl).sort()[0];
  const st = (it) => {
    const s = it.status;
    const sat = mi(it.kode)?.sat || "";
    if (s == "Draft") return [0, "t-gray", "Draft, belum diajukan"];
    if (s == "Menunggu Approval") return [0, "t-warn", "Menunggu persetujuan atasan"];
    if (s == "Approved")
      return it.tahan ? [1, "t-warn", "Ditahan: " + it.alasan] : [1, "t-info", "Disetujui, menunggu diproses ke ERO"];
    if (s == "Masuk Konsolidasi") return [2, "t-vio", "Dikonsolidasi, belum masuk ERO"];
    if (s == "Sudah di ERO") {
      const b = berhak(it);
      const a = diambil(it);
      if (a >= +it.qty) return [4, "t-ok", "Sudah diambil semua"];
      if (b - a > 0) return [4, "t-ok", `Siap diambil ${b - a} dari ${it.qty} ${sat}`];
      const srl = SRLof(KN(it.kon)?.srl);
      return [
        3,
        "t-vio",
        "Sudah di ERO (" + (KN(it.kon)?.srl || "-") + "), menunggu barang datang" + (srl ? " (est. " + D(srl.est) + ")" : "")
      ];
    }
    return [-1, s == "Ditolak" ? "t-bad" : "t-gray", s];
  };
  const poolAll = (d) => I.filter((i) => i.status == "Approved" && !i.kon && RQ(i.req) && deptOf(i) == d);
  const poolOf = (d) => poolAll(d).filter((i) => !i.tahan);
  return {
    user,
    nm,
    uid,
    mi,
    KN,
    RQ,
    SRLof,
    live,
    total,
    datang,
    sisa,
    ord,
    berhak,
    diambil,
    siap,
    deptOf,
    lastArrival,
    firstArrival,
    st,
    poolAll,
    poolOf,
    reminders: (itemId) => RM.filter((x) => x.item == itemId)
  };
}

// src/data/seed.js
function buildSeed() {
  const U = T(
    `hendra.mgr|Hendra Wijaya|Produksi|Atasan|
budi.spv|Budi Hartono|Produksi|Atasan|hendra.mgr
andi.prod|Andi Saputra|Produksi|User|budi.spv
siti.prod|Siti Rahma|Produksi|User|budi.spv
rudi.prod|Rudi Firmansyah|Produksi|User|budi.spv
dewi.admin|Dewi Lestari|Produksi|Admin Dept|budi.spv
tono.spv|Tono Sugiarto|Maintenance|Atasan|
maya.mt|Maya Anggraeni|Maintenance|User|tono.spv
rina.mt|Rina Marlina|Maintenance|User|tono.spv
yani.admin|Yani Kusuma|Maintenance|Admin Dept|tono.spv
wati.wh|Wati Handayani|Warehouse|Admin Warehouse|
joko.wh|Joko Susilo|Warehouse|Admin Warehouse|
agus.spv|Agus Prasetyo|Warehouse|Spv Warehouse|`,
    ["id", "n", "dept", "role", "boss"]
  );
  const HP = {
    "hendra.mgr": "6281234560001",
    "budi.spv": "6281234560002",
    "andi.prod": "6281234560003",
    "siti.prod": "6281234560004",
    "rudi.prod": "6281234560005",
    "dewi.admin": "6281234560006",
    "tono.spv": "6281234560007",
    "maya.mt": "6281234560008",
    "rina.mt": "6281234560009",
    "yani.admin": "6281234560010",
    "wati.wh": "6281234560011",
    "joko.wh": "6281234560012",
    "agus.spv": "6281234560013"
  };
  const M = T(
    `SRG-001|Sarung Tangan Kain|Pasang|0|0|3
SRG-002|Masker KN95|Box|1|0|3
APD-007|Helm Safety|Pcs|1|0|7
OLI-010|Oli Hidrolik 20L|Jerigen|0|1|5
BRG-204|Bearing 6204|Pcs|1|1|7
KBL-005|Kabel Tie 30cm|Pack|0|0|2
LAS-021|Kawat Las RB26|Kg|0|0|3`,
    ["k", "n", "sat", "buf", "kons", "lead"]
  );
  const R = T(
    `RQ-001|andi.prod|2026-11-03|Disetujui|
RQ-002|siti.prod|2026-11-03|Disetujui|
RQ-003|rudi.prod|2026-11-03|Disetujui|
RQ-004|siti.prod|2026-11-12|Disetujui|
RQ-005|rudi.prod|2026-11-12|Disetujui|
RQ-006|maya.mt|2026-11-04|Disetujui|
RQ-007|rina.mt|2026-11-04|Disetujui|
RQ-008|siti.prod|2026-11-18|Menunggu Approval|
RQ-009|andi.prod|2026-11-18|Draft|
RQ-010|rudi.prod|2026-11-09|Ditolak|Stok helm masih cukup, tunda dulu
RQ-011|andi.prod|2026-11-10|Dibatalkan|`,
    ["id", "by", "tgl", "st", "cat"]
  );
  const I = T(
    `ITM-001|RQ-001|SRG-001|10|2026-11-16|2026-11-25|Sudah di ERO|2026-11-04|KON-001||
ITM-002|RQ-001|SRG-002|20|2026-11-16||Sudah di ERO|2026-11-04|KON-002||
ITM-003|RQ-002|SRG-001|10|2026-11-16|2026-11-20|Sudah di ERO|2026-11-04|KON-001||
ITM-004|RQ-003|SRG-001|10|2026-11-16|2026-12-02|Sudah di ERO|2026-11-04|KON-001||
ITM-005|RQ-004|BRG-204|4|2026-11-30||Approved|2026-11-12||Y|Menunggu konfirmasi spesifikasi bearing
ITM-006|RQ-005|LAS-021|5|2026-11-30|2026-12-05|Approved|2026-11-13|||
ITM-007|RQ-006|OLI-010|4|2026-11-17|2026-11-25|Sudah di ERO|2026-11-05|KON-003||
ITM-008|RQ-006|BRG-204|6|2026-11-25||Approved|2026-11-05|||
ITM-009|RQ-007|OLI-010|2|2026-11-17|2026-12-02|Sudah di ERO|2026-11-05|KON-003||
ITM-010|RQ-008|KBL-005|3|2026-12-03|2026-12-10|Menunggu Approval||||
ITM-011|RQ-009|OLI-010|2|2026-12-03|2026-12-10|Draft||||
ITM-012|RQ-010|APD-007|2|2026-11-23||Ditolak||||
ITM-013|RQ-011|LAS-021|1|2026-11-20|2026-12-01|Dibatalkan||||`,
    ["id", "req", "kode", "qty", "datang", "pakai", "status", "appr", "kon", "tahan", "alasan"]
  );
  const K = T(
    `KON-001|Produksi|SRG-001|Sudah di ERO|SRL-2611-001|30|0|
KON-002|Produksi|SRG-002|Sudah di ERO|SRL-2611-001|20|0|
KON-003|Maintenance|OLI-010|Sudah di ERO|SRL-2611-002|6|2|Supplier tidak bisa kirim sisa 2 jerigen`,
    ["id", "dept", "kode", "tahap", "srl", "ero", "tutup", "alasan"]
  );
  const L = T(
    `SRL-2611-001|Produksi|2026-11-16
SRL-2611-002|Maintenance|2026-11-17`,
    ["no", "dept", "est"]
  );
  const KD = T(
    `KON-001|15|0|wati.wh||2026-11-16
KON-002|20|5|wati.wh|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|joko.wh||2026-11-17`,
    ["kon", "qty", "lebih", "by", "cat", "tgl"]
  );
  const SR = T(
    `ITM-003|10|siti.prod
ITM-002|20|andi.prod`,
    ["item", "qty", "to"]
  );
  {
    const A = [
      ["GRD-101", "Mata Gerinda Potong 4 inci", "Pcs", 0],
      ["GRD-102", "Mata Gerinda Poles 4 inci", "Pcs", 0],
      ["BOR-201", "Mata Bor HSS 8mm", "Pcs", 0],
      ["BOR-202", "Mata Bor HSS 10mm", "Pcs", 0],
      ["BLT-301", "Baut Hex M10x50", "Box", 1],
      ["BLT-302", "Mur Hex M10", "Box", 1],
      ["BLT-303", "Ring Plat M10", "Box", 1],
      ["SLG-401", "Selang Hidrolik 1/2 inci", "Meter", 0],
      ["SLG-402", "Klem Selang 1 inci", "Pcs", 0],
      ["FTG-501", "Fitting Nipple 1/2 inci", "Pcs", 0],
      ["BRG-205", "Bearing 6205", "Pcs", 1],
      ["BRG-206", "Bearing 6206", "Pcs", 1],
      ["SEL-601", "Oil Seal 35x52x7", "Pcs", 1],
      ["VBT-401", "V-Belt B-52", "Pcs", 1],
      ["KBL-006", "Kabel NYAF 1.5mm", "Roll", 0],
      ["LMP-701", "Lampu LED Highbay 100W", "Pcs", 0],
      ["CTR-801", "Kontaktor 3P 25A", "Pcs", 0],
      ["SKR-901", "Sekring Cartridge 10A", "Box", 1],
      ["LKT-101", "Lakban Isolasi Hitam", "Roll", 0],
      ["PNT-201", "Cat Marking Kuning", "Kaleng", 0]
    ];
    const P = ["andi.prod", "siti.prod", "rudi.prod"];
    const no = "SRL-2611-003";
    for (let n = 0; n < 6; n++)
      R.push({ id: "RQ-0" + (12 + n), by: P[n % 3], tgl: n < 3 ? "2026-11-14" : "2026-11-15", st: "Disetujui", cat: "" });
    L.push({ no, dept: "Produksi", est: "2026-11-24" });
    A.forEach(([k, nama, sat, buf], i) => {
      M.push({ k, n: nama, sat, buf: String(buf), kons: "0", lead: String(3 + i % 4) });
      const kid = "KON-" + String(5 + i).padStart(3, "0");
      const rs = i % 2 ? [i % 3] : [i % 3, (i + 1) % 3];
      const dt = addDays("2026-11-20", i % 6);
      let tot = 0;
      rs.forEach((r, j) => {
        const q = j ? i * 5 % 6 + 1 : i * 7 % 9 + 2;
        const id = "ITM-" + String(I.length + 1).padStart(3, "0");
        tot += q;
        I.push({
          id,
          req: "RQ-0" + (12 + r + (i < 10 ? 0 : 3)),
          kode: k,
          qty: String(q),
          datang: dt,
          pakai: buf ? "" : addDays(dt, 3 + i % 5),
          status: "Sudah di ERO",
          appr: "2026-11-16T08:" + String(10 + i).padStart(2, "0"),
          kon: kid,
          tahan: "",
          alasan: ""
        });
        if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: P[r] });
      });
      K.push({ id: kid, dept: "Produksi", kode: k, tahap: "Sudah di ERO", srl: no, ero: String(tot), tutup: "0", alasan: "" });
      if (i < 6)
        KD.push({ kon: kid, qty: String(tot), lebih: "0", by: "wati.wh", cat: "", tgl: "2026-11-18" });
      else if (i < 12)
        KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: "0", by: "joko.wh", cat: "", tgl: "2026-11-21" });
    });
  }
  K.forEach((k) => k.by = k.dept == "Produksi" ? "dewi.admin" : "yani.admin");
  SR.forEach((s, n) => s.tgl = addDays("2026-11-18", n % 3));
  const db2 = { U, HP, M, R, I, K, L, KD, SR, RM: [] };
  const sel2 = makeSel(db2);
  db2.I.filter((i) => i.status == "Sudah di ERO" && sel2.siap(i) > 0).forEach((i, n) => {
    for (let c = 0; c < n % 4; c++)
      db2.RM.push({ item: i.id, by: "wati.wh", at: addDays(today(), -(n % 4 - c)) + "T09:00" });
  });
  return db2;
}

// src/lib/actions.js
var EPS = 1e-9;
var ROLES = ["User", "Atasan", "Admin Dept", "Admin Warehouse", "Spv Warehouse"];
var dead = (s) => s == "Ditolak" || s == "Dibatalkan";
var num = (v) => v === "" || v == null ? NaN : +v;
var reqIn = (d, id, allowed) => {
  const r = d.R.find((x) => x.id == id);
  if (!r) return { err: "Request tidak ditemukan. Muat ulang halaman." };
  if (!allowed.includes(r.st)) return { err: `${id} sudah berstatus "${r.st}", aksi ini tidak bisa dilakukan.` };
  return { r };
};
var setR = (d, id, s) => {
  d.R.find((r) => r.id == id).st = s;
  d.I.filter((i) => i.req == id).forEach((i) => {
    if (!dead(i.status)) i.status = s;
  });
};
var bossErr = (sel2, u) => {
  if (!u?.boss) return "Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.";
  const b = sel2.user(u.boss);
  if (!b) return "Atasan Anda tidak ditemukan di daftar pengguna. Hubungi admin departemen.";
  if (b.off) return `Atasan Anda (${b.n}) nonaktif. Hubungi admin departemen untuk menggantinya.`;
  return null;
};
var actor = (sel2, id, role) => {
  const u = sel2.user(id);
  if (!u || u.off) return { err: "Pengguna tidak dikenal atau nonaktif." };
  if (role && u.role != role) return { err: `Aksi ini hanya untuk ${role}.` };
  return { u };
};
var above = (d, id, boss) => {
  const seen = /* @__PURE__ */ new Set();
  for (let c = boss; c && !seen.has(c); c = d.U.find((u) => u.id == c)?.boss) {
    if (c == id) return true;
    seen.add(c);
  }
  return false;
};
var actions = {
  saveUser(sel2, d, f) {
    const { mode, self, id, n, rawWa, email, role, boss, dept, active, me } = f;
    const a = actor(sel2, me?.id);
    if (a.err) return a;
    const admin = a.u.role == "Admin Warehouse" || a.u.role == "Admin Dept";
    const w = wa(rawWa);
    if (!n) return { err: "Isi nama." };
    if (rawWa && !w) return { err: "Nomor WhatsApp tidak valid. Contoh: 081234567890." };
    const bossCheck = (uid, r, dp) => {
      if (r == "User" && !boss) return "Pilih atasan untuk user, supaya request bisa disetujui.";
      if (!boss) return null;
      const b = d.U.find((x) => x.id == boss);
      if (!b) return "Atasan tidak ditemukan.";
      if (b.role != "Atasan") return `${b.n} bukan berperan Atasan.`;
      if (b.off) return `${b.n} nonaktif, pilih atasan lain.`;
      if (uid && above(d, uid, boss)) return "Atasan tidak valid: membuat rantai atasan berputar.";
      if (a.u.role == "Admin Dept" && b.dept != dp) return "Atasan harus dari departemen yang sama.";
      return null;
    };
    if (mode == "new") {
      if (!admin) return { err: "Hanya admin yang bisa menambah pengguna." };
      const e = (email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(e)) return { err: "Isi email yang valid." };
      if (d.U.find((u2) => u2.id.toLowerCase() == e)) return { err: "Email sudah terdaftar." };
      if (!w) return { err: "Nomor WhatsApp wajib diisi untuk pengguna baru." };
      if (!ROLES.includes(role)) return { err: "Role tidak valid." };
      if (a.u.role == "Admin Dept" && !["User", "Atasan", "Admin Dept"].includes(role))
        return { err: "Admin Dept hanya bisa menambah User, Atasan, atau Admin Dept." };
      const dp = a.u.role == "Admin Warehouse" ? (dept || "").trim() : a.u.dept;
      if (!dp) return { err: "Isi departemen." };
      const be = bossCheck(null, role, dp);
      if (be) return { err: be };
      d.U.push({ id: e, n, dept: dp, role, boss: boss || "" });
      d.HP[e] = w;
      return { ok: "Pengguna ditambahkan." };
    }
    const u = d.U.find((x) => x.id == id);
    if (!u) return { err: "Pengguna tidak ditemukan. Muat ulang halaman." };
    if (self) {
      if (u.id != a.u.id) return { err: "Profil hanya bisa diubah oleh pemiliknya." };
    } else {
      if (!admin) return { err: "Hanya admin yang bisa mengubah pengguna." };
      if (a.u.role == "Admin Dept" && u.dept != a.u.dept) return { err: "Pengguna ini bukan dari departemen Anda." };
      if (!ROLES.includes(role)) return { err: "Role tidak valid." };
      if (a.u.role == "Admin Dept" && !["User", "Atasan", "Admin Dept"].includes(role))
        return { err: "Admin Dept hanya bisa memberi role User, Atasan, atau Admin Dept." };
      const dp = a.u.role == "Admin Warehouse" && dept ? dept : u.dept;
      const be = bossCheck(u.id, role, dp);
      if (be) return { err: be };
      const willOff = active !== void 0 ? !active : !!u.off;
      if (u.id == a.u.id && (willOff || role != u.role)) return { err: "Anda tidak bisa menonaktifkan atau mengubah role akun sendiri." };
      if (u.role == "Atasan" && (willOff || role != "Atasan")) {
        const subs = d.U.filter((x) => x.boss == u.id && !x.off);
        if (subs.length) return { err: `${u.n} masih jadi atasan ${subs.length} pengguna aktif. Pindahkan atasan mereka dulu.` };
      }
    }
    u.n = n;
    if (w) d.HP[u.id] = w;
    else delete d.HP[u.id];
    if (!self) {
      u.role = role;
      u.boss = boss || "";
      if (a.u.role == "Admin Warehouse" && dept) u.dept = dept;
      if (active !== void 0) u.off = !active;
    }
    return { ok: "Perubahan disimpan." };
  },
  saveRequest(sel2, d, { status, lines, me }) {
    const { mi } = sel2;
    if (status != "Draft" && status != "Menunggu Approval") return { err: "Status request tidak valid." };
    const a = actor(sel2, me?.id);
    if (a.err) return { err: "Akun nonaktif tidak bisa membuat request." };
    if (status == "Menunggu Approval") {
      const e = bossErr(sel2, a.u);
      if (e) return { err: e };
    }
    if (!lines?.length) return { err: "Tambahkan minimal satu barang." };
    const t = today();
    for (const x of lines) {
      const m = x.kode && mi(x.kode);
      if (!m) return { err: "Pilih barang di setiap baris." };
      const q = num(x.qty);
      if (!Number.isFinite(q) || !(q > 0)) return { err: `${m.n}: jumlah harus lebih dari 0.` };
      const min = addDays(t, +m.lead);
      if (!isDate(x.datang) || x.datang < min) return { err: `${m.n}: tgl datang paling cepat ${D(min)}.` };
      if (m.buf == "0" && !x.pakai) return { err: `${m.n}: tgl pakai wajib untuk barang non buffer.` };
      if (x.pakai && !isDate(x.pakai)) return { err: `${m.n}: tgl pakai tidak valid.` };
      if (x.pakai && x.pakai < x.datang) return { err: `${m.n}: tgl pakai tidak boleh sebelum tgl datang.` };
    }
    const id = nextId(d.R, "RQ-");
    d.R.push({ id, by: a.u.id, tgl: t, st: status, cat: "" });
    lines.forEach(
      (x) => d.I.push({
        id: nextId(d.I, "ITM-"),
        req: id,
        kode: x.kode,
        qty: String(+x.qty),
        datang: x.datang,
        pakai: x.pakai || "",
        status,
        appr: "",
        kon: "",
        tahan: "",
        alasan: ""
      })
    );
    return { ok: status == "Draft" ? "Draft disimpan." : "Diajukan ke atasan." };
  },
  ajukan(sel2, d, id, by) {
    const g = reqIn(d, id, ["Draft"]);
    if (g.err) return g;
    if (g.r.by != by) return { err: "Hanya pembuat request yang bisa mengajukan." };
    const u = sel2.user(g.r.by);
    if (u?.off) return { err: "Akun nonaktif tidak bisa mengajukan request." };
    const e = bossErr(sel2, u);
    if (e) return { err: e };
    const t = today();
    for (const i of d.I.filter((x) => x.req == id && !dead(x.status))) {
      const m = sel2.mi(i.kode);
      if (!m) return { err: `Barang ${i.kode} tidak ada di master. Hubungi admin.` };
      const min = addDays(t, +m.lead);
      if (i.datang < min)
        return { err: `${m.n}: tgl datang ${D(i.datang)} sudah lewat batas minimal (${D(min)}). Batalkan draft ini lalu buat request baru.` };
    }
    setR(d, id, "Menunggu Approval");
    return { ok: "Diajukan ke atasan." };
  },
  batal(sel2, d, id, by) {
    const g = reqIn(d, id, ["Draft", "Menunggu Approval"]);
    if (g.err) return g;
    if (g.r.by != by) return { err: "Hanya pembuat request yang bisa membatalkan." };
    setR(d, id, "Dibatalkan");
    return { ok: "Request dibatalkan." };
  },
  setuju(sel2, d, id, by) {
    const g = reqIn(d, id, ["Menunggu Approval"]);
    if (g.err) return g;
    const r = g.r;
    if (sel2.user(r.by)?.boss != by) return { err: "Hanya atasan langsung pembuat request yang bisa menyetujui." };
    r.st = "Disetujui";
    d.I.filter((i) => i.req == id && i.status == "Menunggu Approval").forEach((i) => {
      i.status = "Approved";
      i.appr = nowStr();
    });
    const dp = sel2.user(r.by)?.dept;
    const ad = d.U.find((u) => u.role == "Admin Dept" && u.dept == dp && !u.off);
    return {
      ok: ad ? `Disetujui. Diteruskan ke ${ad.n} (Admin ${dp}).` : `Disetujui, tapi belum ada Admin Dept aktif di ${dp}. Hubungi Admin Warehouse.`
    };
  },
  setujuAll(sel2, d, meId) {
    const l = d.R.filter((r) => r.st == "Menunggu Approval" && sel2.user(r.by)?.boss == meId);
    if (!l.length) return { err: "Tidak ada request yang menunggu." };
    l.forEach((r) => {
      r.st = "Disetujui";
      d.I.filter((i) => i.req == r.id && i.status == "Menunggu Approval").forEach((i) => {
        i.status = "Approved";
        i.appr = nowStr();
      });
    });
    return { ok: l.length + " request disetujui dan diteruskan ke admin departemen." };
  },
  tolak(sel2, d, id, catatan, by) {
    const g = reqIn(d, id, ["Menunggu Approval"]);
    if (g.err) return g;
    if (sel2.user(g.r.by)?.boss != by) return { err: "Hanya atasan langsung pembuat request yang bisa menolak." };
    if (!catatan) return { err: "Isi catatan sebelum menolak." };
    g.r.cat = catatan;
    setR(d, id, "Ditolak");
    return { ok: "Ditolak." };
  },
  tahan(sel2, d, id, alasan, by) {
    const a = actor(sel2, by, "Admin Dept");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (i.status != "Approved" || i.kon) return { err: "Hanya barang yang menunggu diproses ke ERO yang bisa ditahan." };
    if (sel2.deptOf(i) != a.u.dept) return { err: "Barang ini bukan dari departemen Anda." };
    if (!alasan) return { err: "Isi alasan menahan." };
    i.tahan = "Y";
    i.alasan = alasan;
    return { ok: "Ditahan." };
  },
  lepas(sel2, d, id, by) {
    const a = actor(sel2, by, "Admin Dept");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (i.status != "Approved" || i.kon || !i.tahan) return { err: "Barang ini tidak sedang ditahan." };
    if (sel2.deptOf(i) != a.u.dept) return { err: "Barang ini bukan dari departemen Anda." };
    i.tahan = "";
    i.alasan = "";
    return { ok: "Tahan dilepas." };
  },
  simpanSrl(sel2, d, { no, est, me }) {
    const a = actor(sel2, me?.id, "Admin Dept");
    if (a.err) return a;
    const dept = a.u.dept;
    const nomor = (no || "").trim();
    if (!nomor) return { err: "Isi nomor SRL dari ERO." };
    if (d.L.find((l) => String(l.no).toLowerCase() == nomor.toLowerCase())) return { err: "Nomor SRL ini sudah pernah disimpan." };
    if (est && (!isDate(est) || est < today())) return { err: "Estimasi datang tidak valid (tidak boleh sebelum hari ini)." };
    const p = sel2.poolOf(dept);
    if (!p.length) return { err: "Tidak ada request yang siap diproses." };
    d.L.push({ no: nomor, dept, est: est || "" });
    const g = {};
    p.forEach((i) => (g[i.kode] = g[i.kode] || []).push(i));
    Object.entries(g).forEach(([k, arr]) => {
      const id = nextId(d.K, "KON-");
      d.K.push({ id, dept, by: a.u.id, kode: k, tahap: "Sudah di ERO", srl: nomor, ero: String(sum(arr, (i) => i.qty)), tutup: "0", alasan: "" });
      arr.forEach((i) => {
        i.status = "Sudah di ERO";
        i.kon = id;
      });
    });
    return { ok: `${p.length} request masuk ${nomor}. Status otomatis Sudah di ERO.` };
  },
  tutup(sel2, d, id, alasan, by) {
    const a = actor(sel2, by, "Admin Dept");
    if (a.err) return a;
    const k = d.K.find((x) => x.id == id);
    if (!k) return { err: "Konsolidasi tidak ditemukan. Muat ulang halaman." };
    if (k.dept != a.u.dept) return { err: "Konsolidasi ini bukan dari departemen Anda." };
    const s = sel2.sisa(k);
    if (!(s > 0)) return { err: "Tidak ada sisa untuk ditutup." };
    if (!alasan) return { err: "Isi alasan menutup sisa." };
    k.alasan = alasan;
    k.tutup = String(sum([{ v: k.tutup }, { v: s }], (x) => x.v));
    return { ok: "Sisa ditutup." };
  },
  datang(sel2, d, { id, q, l, cat, by }) {
    const a = actor(sel2, by, "Admin Warehouse");
    if (a.err) return a;
    const k = d.K.find((x) => x.id == id);
    if (!k) return { err: "Konsolidasi tidak ditemukan. Muat ulang halaman." };
    const qq = num(q) || 0;
    const ll = num(l) || 0;
    if (!Number.isFinite(qq) || !Number.isFinite(ll) || qq < 0 || ll < 0) return { err: "Qty tidak boleh negatif." };
    if (!(qq > 0) && !(ll > 0)) return { err: "Isi Qty datang." };
    const s = sel2.sisa(k);
    if (qq > s + EPS) return { err: "Qty datang melebihi sisa (" + s + ")." };
    if (ll > 0 && !cat) return { err: "Isi catatan untuk kelebihan." };
    d.KD.push({ kon: id, qty: String(qq), lebih: String(ll), by: a.u.id, cat: cat || "", tgl: today() });
    return { ok: "Kedatangan dicatat." };
  },
  datangAll(sel2, d, no, by) {
    const a = actor(sel2, by, "Admin Warehouse");
    if (a.err) return a;
    const list = d.K.filter((k) => k.srl == no && k.tahap == "Sudah di ERO" && sel2.sisa(k) > 0);
    if (!list.length) return { err: "Tidak ada sisa untuk dicatat." };
    list.forEach((k) => d.KD.push({ kon: k.id, qty: String(sel2.sisa(k)), lebih: "0", by: a.u.id, cat: "", tgl: today() }));
    return { ok: list.length + " barang dicatat datang sesuai jumlah di " + no + "." };
  },
  serah(sel2, d, id, q, by) {
    const a = actor(sel2, by, "Admin Warehouse");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (i.status != "Sudah di ERO") return { err: "Barang ini belum masuk ERO." };
    const mx = sel2.siap(i);
    const qq = num(q);
    if (!Number.isFinite(qq) || !(qq > 0) || qq > mx + EPS) return { err: "Qty harus antara 1 dan " + mx + "." };
    d.SR.push({ item: id, qty: String(qq), to: sel2.RQ(i.req).by, tgl: today() });
    return { ok: "Diserahkan." };
  },
  ingat(sel2, d, id, by) {
    const a = actor(sel2, by, "Admin Warehouse");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (!(sel2.siap(i) > 0)) return { err: "Barang ini belum siap diambil, tidak perlu diingatkan." };
    d.RM.push({ item: id, by: a.u.id, at: nowStr() });
  }
};

// src/lib/diff.js
var KEYED = { U: "id", M: "k", R: "id", I: "id", K: "id", L: "no" };
var APPEND = ["KD", "SR", "RM"];
var userRows = (db2) => db2.U.map((u) => ({ ...u, hp: db2.HP[u.id] || "", off: u.off ? "Y" : "" }));
function diffDb(a, b) {
  if (a === b) return [];
  const ops = [];
  for (const t of Object.keys(KEYED)) {
    const key = KEYED[t];
    const ra = t === "U" ? userRows(a) : a[t];
    const rb = t === "U" ? userRows(b) : b[t];
    if (t !== "U" && ra === rb) continue;
    const old = new Map(ra.map((r) => [r[key], r]));
    for (const r of rb) {
      const o = old.get(r[key]);
      if (!o) ops.push({ t, op: "add", row: r });
      else if (o !== r && JSON.stringify(o) !== JSON.stringify(r)) ops.push({ t, op: "set", row: r });
    }
  }
  for (const t of APPEND) {
    for (let i = a[t].length; i < b[t].length; i++) ops.push({ t, op: "add", row: b[t][i] });
  }
  return ops;
}

// scripts/verify.mjs
var pass = 0;
var fail = 0;
var ok = (cond, name, extra = "") => {
  if (cond) pass++;
  else {
    fail++;
    console.log("  GAGAL:", name, extra);
  }
};
var section = (s) => console.log("\n# " + s);
var gs = vm.createContext({ console, Logger: { log() {
} } });
vm.runInContext(fs.readFileSync("apps-script/Code.gs", "utf8"), gs);
var TABLES = ["U", "M", "R", "I", "K", "L", "KD", "SR", "RM"];
var strRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === true ? "Y" : v == null ? "" : String(v)]));
var toServer = (db2) => ({
  U: db2.U.map((u) => strRow({ ...u, hp: db2.HP[u.id] || "", off: u.off ? "Y" : "" })),
  ...Object.fromEntries(["M", "R", "I", "K", "L", "KD", "SR", "RM"].map((t) => [t, db2[t].map(strRow)]))
});
var cols = (t) => gs.SCHEMA[t].cols;
var canon = (t, r) => Object.fromEntries(cols(t).map((c) => [c, r[c] == null ? "" : String(r[c])]));
var canonDb = (tb) => JSON.stringify(Object.fromEntries(TABLES.map((t) => [t, tb[t].map((r) => canon(t, r))])));
var jsonClone = (o) => JSON.parse(JSON.stringify(o));
function run(db2, name, ...args) {
  let res;
  const next = produce(db2, (d) => {
    res = actions[name](makeSel(d), d, ...args);
  });
  if (res?.err) return { err: res.err };
  return { db: next, ops: diffDb(db2, next), res };
}
function serverApply(prevDb, ops, preOverride, uid) {
  const pre = preOverride || toServer(prevDb);
  try {
    const plan = gs.planOps_(jsonClone(pre), jsonClone(ops));
    gs.validateChanges_(plan.post, plan.changes, uid);
    return { post: plan.post };
  } catch (e) {
    return { err: e.message, conflict: !!e.conflict };
  }
}
function good(db2, label, name, ...args) {
  const r = run(db2, name, ...args);
  if (r.err) {
    ok(false, label, "(klien menolak: " + r.err + ")");
    return db2;
  }
  const s = serverApply(db2, r.ops);
  if (s.err) {
    ok(false, label, "(server menolak: " + s.err + ")");
    return r.db;
  }
  ok(canonDb(s.post) === canonDb(toServer(r.db)), label + " [klien == server]");
  const audit = gs.auditAll_(jsonClone(s.post));
  ok(audit.length === 0, label + " [audit penuh]", audit.join(" | "));
  return r.db;
}
function badClient(db2, label, name, ...args) {
  const r = run(db2, name, ...args);
  ok(!!r.err, label + " [ditolak klien]", r.err ? "" : "(malah diterima)");
}
function badServer(db2, label, ops, { conflict, pre } = {}) {
  const s = serverApply(db2, ops, pre);
  ok(!!s.err, label + " [ditolak server]", s.err ? "" : "(malah diterima)");
  if (s.err && conflict !== void 0) ok(s.conflict === conflict, label + " [jenis galat konflik=" + conflict + "]", s.err);
}
section("1. Data contoh");
var seed = buildSeed();
{
  const errs = gs.auditAll_(jsonClone(toServer(seed)));
  ok(errs.length === 0, "audit server atas seed.js", errs.join(" | "));
  const gsText = fs.readFileSync("apps-script/Seed.gs", "utf8");
  const m = gsText.match(/var SEED_DB = (\{.*\});/s);
  const gsDb = JSON.parse(m[1]);
  const errs2 = gs.auditAll_(jsonClone(toServer(gsDb)));
  ok(errs2.length === 0, "audit server atas Seed.gs", errs2.join(" | "));
  const strip = (db2) => JSON.stringify({ ...db2, RM: db2.RM.map((r) => r.item + r.by) });
  ok(strip(gsDb) === strip(seed), "Seed.gs sinkron dengan seed.js (jalankan `npm run gen:seed` bila gagal)");
}
section("2. Alur lengkap: request -> persetujuan -> SRL -> kedatangan -> serah terima");
var T2 = today();
var kb = (kode, qty, lead, pakai = "") => ({ kode, qty: String(qty), datang: addDays(T2, lead), pakai });
var db = seed;
db = good(db, "andi membuat draft", "saveRequest", { status: "Draft", lines: [kb("KBL-005", 3, 2, addDays(T2, 9))], me: db.U.find((u) => u.id === "andi.prod") });
var idDraft = db.R[db.R.length - 1].id;
ok(idDraft === "RQ-018", "ID request berikutnya RQ-018", idDraft);
ok(db.I[db.I.length - 1].id === "ITM-044", "ID item berikutnya ITM-044");
db = good(db, "andi mengajukan draft", "ajukan", idDraft, "andi.prod");
db = good(db, "siti langsung mengajukan 2 barang", "saveRequest", {
  status: "Menunggu Approval",
  lines: [kb("LAS-021", 2, 3, addDays(T2, 10)), kb("SRG-002", 5, 3)],
  me: db.U.find((u) => u.id === "siti.prod")
});
var idSiti = db.R[db.R.length - 1].id;
db = good(db, "budi menyetujui request andi", "setuju", idDraft, "budi.spv");
db = good(db, "budi menolak request siti (dengan catatan)", "tolak", idSiti, "Belum dibutuhkan", "budi.spv");
ok(db.I.filter((i) => i.req === idSiti).every((i) => i.status === "Ditolak"), "barang request ditolak ikut Ditolak");
db = good(db, "rudi mengajukan", "saveRequest", { status: "Menunggu Approval", lines: [kb("KBL-005", 4, 2, addDays(T2, 8))], me: db.U.find((u) => u.id === "rudi.prod") });
db = good(db, "budi setujui semua", "setujuAll", "budi.spv");
var poolItem = db.I.find((i) => i.status === "Approved" && !i.kon && i.kode === "KBL-005" && !i.tahan);
db = good(db, "dewi menahan barang", "tahan", poolItem.id, "Tunggu spesifikasi", "dewi.admin");
db = good(db, "dewi melepas tahan", "lepas", poolItem.id, "dewi.admin");
var dewi = db.U.find((u) => u.id === "dewi.admin");
db = good(db, "dewi menyimpan SRL", "simpanSrl", { no: "SRL-2611-099", est: addDays(T2, 5), me: dewi });
var kNew = db.K.filter((k) => k.srl === "SRL-2611-099");
ok(kNew.length >= 1 && kNew.every((k) => k.by === "dewi.admin"), "konsolidasi baru menyimpan ID pembuat", JSON.stringify(kNew.map((k) => k.by)));
var kKbl = kNew.find((k) => k.kode === "KBL-005");
ok(+kKbl.ero === db.I.filter((i) => i.kon === kKbl.id).reduce((a, i) => a + +i.qty, 0) && +kKbl.ero === 10, "ERO KBL-005 = jumlah barang di dalamnya (3 + 3 + 4)", kKbl && kKbl.ero);
db = good(db, "wati catat datang sebagian", "datang", { id: kKbl.id, q: 3, l: 0, cat: "", by: "wati.wh" });
db = good(db, "wati catat sisa + kelebihan bercatatan", "datang", { id: kKbl.id, q: 4, l: 1, cat: "Supplier kirim lebih", by: "wati.wh" });
ok(db.KD.at(-1).by === "wati.wh", "kedatangan menyimpan ID pencatat");
var kOther = kNew.find((k) => k.id !== kKbl.id);
if (kOther) db = good(db, "joko catat semua kedatangan SRL", "datangAll", "SRL-2611-099", "joko.wh");
var itemsK = db.I.filter((i) => i.kon === kKbl.id);
var sel = makeSel(db);
var first = itemsK.slice().sort(sel.ord)[0];
db = good(db, "wati menyerahkan barang", "serah", first.id, sel.siap(first), "wati.wh");
ok(db.SR.at(-1).to === sel.RQ(first.req).by, "serah terima menyimpan ID penerima");
db = good(db, "wati mengingatkan barang siap", "ingat", itemsK.find((i) => makeSel(db).siap(i) > 0)?.id || first.id, "wati.wh");
db = good(db, "yani/dewi menutup sisa", "tutup", "KON-013", "Supplier tidak sanggup", "dewi.admin");
ok(makeSel(db).sisa(db.K.find((k) => k.id === "KON-013")) === 0, "sisa menjadi 0 setelah ditutup");
section("3. Pengguna");
db = good(db, "admin menambah pengguna baru", "saveUser", { mode: "new", email: "baru@x.com", n: "Baru", rawWa: "081200000001", role: "User", boss: "budi.spv", me: dewi });
db = good(db, "admin mengubah nama pengguna", "saveUser", { mode: "edit", id: "baru@x.com", n: "Baru Sekali", rawWa: "081200000001", role: "User", boss: "budi.spv", active: true, me: dewi });
db = good(db, "admin menonaktifkan pengguna", "saveUser", { mode: "edit", id: "baru@x.com", n: "Baru Sekali", rawWa: "081200000001", role: "User", boss: "budi.spv", active: false, me: dewi });
badClient(db, "nonaktif tidak bisa membuat request", "saveRequest", { status: "Draft", lines: [kb("KBL-005", 1, 2, addDays(T2, 9))], me: db.U.find((u) => u.id === "baru@x.com") });
var before = makeSel(db);
db = good(db, "ganti nama Wati", "saveUser", { mode: "edit", id: "wati.wh", n: "Wati H. Baru", rawWa: "6281234560011", role: "Admin Warehouse", boss: "", active: true, me: db.U.find((u) => u.id === "wati.wh"), self: true });
var after = makeSel(db);
ok(after.nm("wati.wh") === "Wati H. Baru" && db.KD.some((d) => d.by === "wati.wh"), "riwayat tetap tertaut ke Wati setelah ganti nama");
section("4. Klien menolak aksi tak sah");
var s0 = seed;
var andi = s0.U.find((u) => u.id === "andi.prod");
badClient(s0, "ajukan request yang bukan Draft", "ajukan", "RQ-001", "andi.prod");
badClient(s0, "setuju request yang sudah Disetujui", "setuju", "RQ-001", "budi.spv");
badClient(s0, "setuju request yang sudah Dibatalkan (tidak boleh hidup lagi)", "setuju", "RQ-011", "budi.spv");
badClient(s0, "setuju oleh bukan atasan langsung", "setuju", "RQ-008", "tono.spv");
badClient(s0, "tolak tanpa catatan", "tolak", "RQ-008", "", "budi.spv");
badClient(s0, "batal request orang lain", "batal", "RQ-009", "siti.prod");
badClient(s0, "batal request yang sudah Disetujui", "batal", "RQ-001", "andi.prod");
badClient(s0, "datang negatif", "datang", { id: "KON-011", q: -3, l: 0, cat: "", by: "wati.wh" });
badClient(s0, "datang qty negatif walau ada kelebihan positif", "datang", { id: "KON-011", q: -3, l: 5, cat: "x", by: "wati.wh" });
badClient(s0, "datang melebihi sisa", "datang", { id: "KON-011", q: 999, l: 0, cat: "", by: "wati.wh" });
badClient(s0, "kelebihan tanpa catatan", "datang", { id: "KON-011", q: 1, l: 2, cat: "", by: "wati.wh" });
badClient(s0, "datang oleh bukan Admin Warehouse", "datang", { id: "KON-011", q: 1, l: 0, cat: "", by: "dewi.admin" });
badClient(s0, "tutup sisa yang sudah 0", "tutup", "KON-003", "alasan", "yani.admin");
badClient(s0, "tutup konsolidasi departemen lain", "tutup", "KON-013", "alasan", "yani.admin");
badClient(s0, "serah melebihi jatah", "serah", "ITM-015", 999, "wati.wh");
badClient(s0, "serah barang yang belum di ERO", "serah", "ITM-006", 1, "wati.wh");
badClient(s0, "tahan barang yang sudah di ERO", "tahan", "ITM-001", "x", "dewi.admin");
badClient(s0, "tahan barang dept lain", "tahan", "ITM-006", "x", "yani.admin");
badClient(s0, "ingat barang yang belum siap", "ingat", "ITM-017", "wati.wh");
badClient(s0, "SRL dengan nomor ganda", "simpanSrl", { no: "srl-2611-001", est: "", me: s0.U.find((u) => u.id === "dewi.admin") });
badClient(s0, "SRL oleh bukan Admin Dept", "simpanSrl", { no: "SRL-X", est: "", me: s0.U.find((u) => u.id === "wati.wh") });
badClient(s0, "request: tgl datang kurang dari lead time", "saveRequest", { status: "Draft", lines: [kb("APD-007", 1, 1)], me: andi });
badClient(s0, "request: qty nol", "saveRequest", { status: "Draft", lines: [kb("KBL-005", 0, 2, addDays(T2, 9))], me: andi });
badClient(s0, "request: non-buffer tanpa tgl pakai", "saveRequest", { status: "Draft", lines: [kb("KBL-005", 1, 2)], me: andi });
badClient(s0, "request tanpa barang", "saveRequest", { status: "Draft", lines: [], me: andi });
badClient(s0, "pengguna: atasan diri sendiri", "saveUser", { mode: "edit", id: "budi.spv", n: "Budi", rawWa: "081200000002", role: "Atasan", boss: "budi.spv", active: true, me: s0.U.find((u) => u.id === "dewi.admin") });
badClient(s0, "pengguna: rantai atasan berputar", "saveUser", { mode: "edit", id: "hendra.mgr", n: "Hendra", rawWa: "081200000001", role: "Atasan", boss: "budi.spv", active: true, me: s0.U.find((u) => u.id === "dewi.admin") });
badClient(s0, "pengguna: menonaktifkan atasan yang masih punya bawahan", "saveUser", { mode: "edit", id: "budi.spv", n: "Budi Hartono", rawWa: "081200000002", role: "Atasan", boss: "hendra.mgr", active: false, me: s0.U.find((u) => u.id === "dewi.admin") });
badClient(s0, "pengguna: User tanpa atasan", "saveUser", { mode: "new", email: "x@y.com", n: "X", rawWa: "081200000009", role: "User", boss: "", me: s0.U.find((u) => u.id === "dewi.admin") });
badClient(s0, "pengguna: Admin Dept memberi role Spv Warehouse", "saveUser", { mode: "new", email: "x@y.com", n: "X", rawWa: "081200000009", role: "Spv Warehouse", boss: "", me: s0.U.find((u) => u.id === "dewi.admin") });
{
  let d = seed;
  d = produce(d, (x) => {
    x.U.push({ id: "nb@x.com", n: "NoBoss", dept: "Produksi", role: "User", boss: "" });
    x.HP["nb@x.com"] = "6281200000077";
  });
  const u = d.U.find((x) => x.id === "nb@x.com");
  badClient(d, "ajukan langsung tanpa atasan", "saveRequest", { status: "Menunggu Approval", lines: [kb("KBL-005", 1, 2, addDays(T2, 9))], me: u });
  const r = run(d, "saveRequest", { status: "Draft", lines: [kb("KBL-005", 1, 2, addDays(T2, 9))], me: u });
  ok(!r.err, "draft tanpa atasan boleh disimpan");
  badClient(r.db, "mengajukan draft tanpa atasan", "ajukan", r.db.R.at(-1).id, "nb@x.com");
}
{
  const d = produce(seed, (x) => {
    x.R = x.R.filter((r2) => r2.id !== "RQ-005");
    x.I = x.I.filter((i) => i.req !== "RQ-005");
  });
  const r = run(d, "saveRequest", { status: "Draft", lines: [kb("KBL-005", 1, 2, addDays(T2, 9))], me: andi });
  ok(r.db.R.at(-1).id === "RQ-018", "ID tidak bertabrakan walau ada nomor yang hilang", r.db.R.at(-1).id);
}
{
  const d = produce(seed, (x) => {
    x.K = [];
    x.I.forEach((i) => {
      if (i.status === "Sudah di ERO") {
        i.status = "Approved";
        i.kon = "";
      }
    });
    x.KD = [];
    x.SR = [];
    x.L = [];
    x.RM = [];
  });
  const r = run(d, "simpanSrl", { no: "SRL-1", est: "", me: d.U.find((u) => u.id === "dewi.admin") });
  ok(!r.err && r.db.K[0].id === "KON-001", "SRL pertama pada tabel konsolidasi kosong", r.err);
}
{
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) {
      a.length ? super(...a) : super("2030-01-02T10:00:00");
    }
  };
  ok(today() === "2030-01-02", "today() mengikuti tanggal saat dipanggil", today());
  globalThis.Date = RealDate;
}
section("5. Server menolak pelanggaran relasi & aturan");
var S = seed;
var row = (t, id, key = "id") => ({ ...S[t].find((r) => r[key] === id) });
var R1 = (t, r) => ({ t, op: "add", row: r });
var SET = (t, r) => ({ t, op: "set", row: r });
badServer(S, "Item dengan request tidak ada", [R1("I", { ...row("I", "ITM-010"), id: "ITM-901", req: "RQ-777" })]);
badServer(S, "Item dengan barang tidak ada", [R1("R", { id: "RQ-018", by: "andi.prod", tgl: T2, st: "Draft", cat: "" }), R1("I", { ...row("I", "ITM-011"), id: "ITM-044", req: "RQ-018", kode: "XXX-999", status: "Draft" })]);
badServer(S, "Request dengan pembuat tidak ada", [R1("R", { id: "RQ-018", by: "hantu", tgl: T2, st: "Draft", cat: "" }), R1("I", { ...row("I", "ITM-011"), id: "ITM-044", req: "RQ-018", status: "Draft" })]);
badServer(S, "Request tanpa barang", [R1("R", { id: "RQ-018", by: "andi.prod", tgl: T2, st: "Draft", cat: "" })]);
badServer(S, "ID request ganda -> konflik", [R1("R", { ...row("R", "RQ-009") })], { conflict: true });
badServer(S, "set baris yang tidak ada -> konflik", [SET("R", { id: "RQ-999", by: "andi.prod", tgl: T2, st: "Draft", cat: "" })], { conflict: true });
badServer(S, "Kedatangan ke konsolidasi tidak ada", [R1("KD", { kon: "KON-999", qty: "1", lebih: "0", by: "wati.wh", cat: "", tgl: T2 })]);
badServer(S, "Kedatangan melebihi sisa", [R1("KD", { kon: "KON-011", qty: "99", lebih: "0", by: "wati.wh", cat: "", tgl: T2 })], { conflict: true });
badServer(S, "Kedatangan negatif", [R1("KD", { kon: "KON-011", qty: "-1", lebih: "0", by: "wati.wh", cat: "", tgl: T2 })]);
badServer(S, "Kedatangan oleh nama (bukan id)", [R1("KD", { kon: "KON-011", qty: "1", lebih: "0", by: "Wati Handayani", cat: "", tgl: T2 })]);
badServer(S, "Kedatangan oleh bukan Admin Warehouse", [R1("KD", { kon: "KON-011", qty: "1", lebih: "0", by: "dewi.admin", cat: "", tgl: T2 })]);
badServer(S, "Serah terima melebihi jatah", [R1("SR", { item: "ITM-015", qty: "99", to: "siti.prod", tgl: T2 })], { conflict: true });
badServer(S, "Serah terima barang belum di ERO", [R1("SR", { item: "ITM-006", qty: "1", to: "rudi.prod", tgl: T2 })]);
badServer(S, "Serah terima ke orang yang bukan peminta", [R1("SR", { item: "ITM-015", qty: "1", to: "andi.prod", tgl: T2 })]);
badServer(S, "Serah terima barang tidak ada", [R1("SR", { item: "ITM-999", qty: "1", to: "andi.prod", tgl: T2 })]);
badServer(S, "Pengingat untuk barang tidak ada", [R1("RM", { item: "ITM-999", by: "wati.wh", at: T2 + "T09:00" })]);
badServer(S, "Pengingat oleh nama", [R1("RM", { item: "ITM-015", by: "Wati Handayani", at: T2 + "T09:00" })]);
badServer(S, "Konsolidasi ke SRL tidak ada", [SET("I", { ...row("I", "ITM-006"), status: "Sudah di ERO", kon: "KON-900" }), R1("K", { id: "KON-900", dept: "Produksi", by: "dewi.admin", kode: "LAS-021", tahap: "Sudah di ERO", srl: "SRL-NONE", ero: "5", tutup: "0", alasan: "" })]);
badServer(S, "ERO tidak sama dengan total barang", [R1("L", { no: "SRL-9", dept: "Produksi", est: "" }), SET("I", { ...row("I", "ITM-006"), status: "Sudah di ERO", kon: "KON-900" }), R1("K", { id: "KON-900", dept: "Produksi", by: "dewi.admin", kode: "LAS-021", tahap: "Sudah di ERO", srl: "SRL-9", ero: "50", tutup: "0", alasan: "" })]);
badServer(S, "Konsolidasi beda departemen dengan SRL", [R1("L", { no: "SRL-9", dept: "Maintenance", est: "" }), SET("I", { ...row("I", "ITM-006"), status: "Sudah di ERO", kon: "KON-900" }), R1("K", { id: "KON-900", dept: "Produksi", by: "dewi.admin", kode: "LAS-021", tahap: "Sudah di ERO", srl: "SRL-9", ero: "5", tutup: "0", alasan: "" })]);
badServer(S, "Tutup melebihi sisa", [SET("K", { ...row("K", "KON-013"), tutup: "99", alasan: "x" })], { conflict: true });
badServer(S, "Tutup tanpa alasan", [SET("K", { ...row("K", "KON-013"), tutup: "5", alasan: "" })]);
badServer(S, "Tutup dikurangi", [SET("K", { ...row("K", "KON-003"), tutup: "0" })]);
badServer(S, "Mengubah kode konsolidasi", [SET("K", { ...row("K", "KON-013"), kode: "KBL-005" })]);
badServer(S, "Setujui request yang sudah Dibatalkan", [SET("R", { ...row("R", "RQ-011"), st: "Disetujui" }), SET("I", { ...row("I", "ITM-013"), status: "Approved", appr: T2 + "T08:00" })], { conflict: true });
badServer(S, "Batalkan request yang sudah Disetujui", [SET("R", { ...row("R", "RQ-001"), st: "Dibatalkan" })], { conflict: true });
badServer(S, "Ajukan request yang sudah Disetujui", [SET("R", { ...row("R", "RQ-001"), st: "Menunggu Approval" })], { conflict: true });
badServer(S, "Barang Approved mundur ke Draft", [SET("I", { ...row("I", "ITM-006"), status: "Draft" })], { conflict: true });
badServer(S, "Request Disetujui tapi barang masih menunggu", [SET("R", { ...row("R", "RQ-008"), st: "Disetujui" })]);
badServer(S, "Ubah qty barang", [SET("I", { ...row("I", "ITM-006"), qty: "500" })]);
badServer(S, "Ubah pembuat request", [SET("R", { ...row("R", "RQ-009"), by: "siti.prod" })]);
badServer(S, "Tolak tanpa catatan", [SET("R", { ...row("R", "RQ-008"), st: "Ditolak" }), SET("I", { ...row("I", "ITM-010"), status: "Ditolak" })]);
badServer(S, "Tahan tanpa alasan", [SET("I", { ...row("I", "ITM-006"), tahan: "Y", alasan: "" })]);
badServer(S, "Ajukan oleh pembuat tanpa atasan", [R1("R", { id: "RQ-018", by: "hendra.mgr", tgl: T2, st: "Menunggu Approval", cat: "" }), R1("I", { ...row("I", "ITM-010"), id: "ITM-044", req: "RQ-018", status: "Menunggu Approval" })]);
badServer(S, "Barang non-buffer baru tanpa tgl pakai", [R1("R", { id: "RQ-018", by: "andi.prod", tgl: T2, st: "Draft", cat: "" }), R1("I", { ...row("I", "ITM-011"), id: "ITM-044", req: "RQ-018", kode: "KBL-005", status: "Draft", pakai: "", datang: addDays(T2, 5) })]);
badServer(S, "Tgl datang kurang dari lead time", [R1("R", { id: "RQ-018", by: "andi.prod", tgl: T2, st: "Draft", cat: "" }), R1("I", { ...row("I", "ITM-011"), id: "ITM-044", req: "RQ-018", kode: "APD-007", status: "Draft", pakai: "", datang: addDays(T2, 1) })]);
badServer(S, "Role pengguna tidak valid", [R1("U", { id: "z@x.com", n: "Z", dept: "Produksi", role: "Dewa", boss: "budi.spv", hp: "6281200000001", off: "" })]);
badServer(S, "Atasan pengguna tidak ada", [R1("U", { id: "z@x.com", n: "Z", dept: "Produksi", role: "User", boss: "hantu", hp: "6281200000001", off: "" })]);
badServer(S, "Atasan bukan berperan Atasan", [R1("U", { id: "z@x.com", n: "Z", dept: "Produksi", role: "User", boss: "andi.prod", hp: "6281200000001", off: "" })]);
badServer(S, "Nomor WA tidak valid", [R1("U", { id: "z@x.com", n: "Z", dept: "Produksi", role: "User", boss: "budi.spv", hp: "12345", off: "" })]);
badServer(S, "Rantai atasan berputar", [SET("U", { ...row("U", "hendra.mgr"), boss: "budi.spv", hp: "6281234560001", off: "" })]);
badServer(S, "Nonaktifkan atasan yang masih punya bawahan", [SET("U", { ...row("U", "budi.spv"), hp: "6281234560002", off: "Y" })]);
badServer(S, "SRL ganda -> konflik", [R1("L", { ...row("L", "SRL-2611-001", "no") })], { conflict: true });
{
  const rev = produce(seed, (d) => {
    d.I.reverse();
  });
  for (const [nama, base] of [["urutan asli", seed], ["urutan dibalik", rev]]) {
    const sl = makeSel(base);
    ok(
      sl.berhak(base.I.find((i) => i.id === "ITM-026")) === 4 && sl.berhak(base.I.find((i) => i.id === "ITM-027")) === 0,
      "jatah seri dibagi menurut id (" + nama + ")"
    );
    const a = run(base, "serah", "ITM-026", 4, "wati.wh");
    ok(!a.err && !serverApply(base, a.ops).err, "serah 4 ke ITM-026 diterima klien & server (" + nama + ")", a.err || serverApply(base, a.ops).err);
    const b = run(base, "serah", "ITM-027", 1, "wati.wh");
    ok(!!b.err, "serah ke ITM-027 (jatah 0) ditolak klien (" + nama + ")");
    badServer(base, "serah ITM-027 (jatah 0) ditolak server (" + nama + ")", [R1("SR", { item: "ITM-027", qty: "1", to: "andi.prod", tgl: T2 })], { conflict: true });
  }
}
{
  const afterA = run(seed, "batal", "RQ-008", "siti.prod").db;
  const staleB = run(seed, "setuju", "RQ-008", "budi.spv");
  const s = serverApply(null, staleB.ops, toServer(afterA));
  ok(!!s.err && s.conflict, "dua klien: setuju atas request yang baru dibatalkan ditolak sebagai konflik", s.err);
}
{
  const a = run(seed, "saveRequest", { status: "Draft", lines: [kb("KBL-005", 1, 2, addDays(T2, 9))], me: andi });
  const b = run(seed, "saveRequest", { status: "Draft", lines: [kb("KBL-005", 2, 2, addDays(T2, 9))], me: seed.U.find((u) => u.id === "siti.prod") });
  const s = serverApply(null, b.ops, toServer(a.db));
  ok(!!s.err && s.conflict, "dua klien membuat nomor request sama: yang kedua ditolak sebagai konflik", s.err);
}
{
  const legacy = jsonClone(toServer(seed));
  legacy.K.forEach((k) => k.by = seed.U.find((u) => u.id === k.by).n);
  const r = run(seed, "tutup", "KON-013", "Supplier tidak sanggup", "dewi.admin");
  const oldRow = legacy.K.find((k) => k.id === "KON-013");
  const op = { t: "K", op: "set", row: { ...r.ops[0].row, by: oldRow.by } };
  const s = serverApply(null, [op], legacy);
  ok(!s.err, "sheet lama (by=nama): tutup sisa tetap diterima sebelum migrasi", s.err);
}
section("6. Audit mendeteksi data yang dirusak manual");
{
  const mutateAndAudit = (label, fn, expectMatch) => {
    const tb = jsonClone(toServer(seed));
    fn(tb);
    const errs = gs.auditAll_(tb);
    ok(errs.some((e) => e.includes(expectMatch)), label, JSON.stringify(errs.slice(0, 3)));
  };
  mutateAndAudit("item yatim (request dihapus)", (tb) => {
    tb.R = tb.R.filter((r) => r.id !== "RQ-006");
  }, 'request "RQ-006" tidak ada');
  mutateAndAudit("kode barang salah", (tb) => {
    tb.I.find((i) => i.id === "ITM-006").kode = "ZZZ";
  }, "tidak ada di Master");
  mutateAndAudit("qty ERO tidak sama", (tb) => {
    tb.K.find((k) => k.id === "KON-013").ero = "99";
  }, "tidak sama dengan total");
  mutateAndAudit("diambil melebihi jatah", (tb) => {
    tb.SR.push({ item: "ITM-015", qty: "50", to: "siti.prod", tgl: T2 });
  }, "melebihi jatah");
  mutateAndAudit("log berisi nama (data lama)", (tb) => {
    tb.KD[0].by = "Wati Handayani";
  }, "bukan id pengguna");
  mutateAndAudit("kunci ganda", (tb) => {
    tb.U.push({ ...tb.U[0] });
  }, "ganda");
}
section("7. Migrasi nama -> ID (migrasiRelasi)");
{
  const legacy = jsonClone(toServer(seed));
  const nm = (id) => seed.U.find((u) => u.id === id).n;
  legacy.K.forEach((k) => k.by = nm(k.by));
  legacy.KD.forEach((d) => d.by = nm(d.by));
  legacy.RM.forEach((r) => r.by = nm(r.by));
  legacy.SR.forEach((s) => s.to = nm(s.to));
  ok(gs.auditAll_(jsonClone(legacy)).length > 0, "data format lama terdeteksi audit");
  const sheets = {};
  TABLES.forEach((t) => {
    sheets[t] = { header: cols(t), rows: legacy[t].map((r) => cols(t).map((c) => r[c])) };
  });
  const mkSheet = (t) => ({
    getLastRow: () => sheets[t].rows.length + 1,
    getMaxRows: () => 5e3,
    getMaxColumns: () => 20,
    insertRowsAfter() {
    },
    getRange: (r, c, n, w) => ({
      getValues: () => sheets[t].rows.slice(r - 2, r - 2 + n).map((x) => x.slice(0, w)),
      clearContent: () => {
        sheets[t].rows = [];
      },
      setNumberFormat() {
        return this;
      },
      setValues: (vals) => {
        sheets[t].rows = vals;
      }
    })
  });
  const byName = Object.fromEntries(TABLES.map((t) => [gs.SCHEMA[t].sheet, t]));
  const props = {};
  Object.assign(gs, {
    LockService: { getScriptLock: () => ({ waitLock() {
    }, releaseLock() {
    } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperties: (o) => Object.assign(props, o) }) },
    SpreadsheetApp: { flush() {
    }, getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(byName[n]) }) },
    Session: { getScriptTimeZone: () => "Asia/Jakarta" },
    Utilities: { formatDate: () => "" }
  });
  const msg = gs.migrasiRelasi();
  ok(/Diperbarui/.test(msg), "migrasiRelasi memperbarui data", msg);
  const migrated = Object.fromEntries(TABLES.map((t) => [t, sheets[t].rows.map((r) => Object.fromEntries(cols(t).map((c, i) => [c, r[i]])))]));
  const errs = gs.auditAll_(jsonClone(migrated));
  ok(errs.length === 0, "audit bersih setelah migrasi", errs.slice(0, 3).join(" | "));
  ok(canonDb(migrated) === canonDb(toServer(seed)), "hasil migrasi identik dengan data berbasis ID");
  ok(/Tidak ada yang perlu/.test(gs.migrasiRelasi()), "migrasi aman dijalankan berulang");
}
section("8. Login, sesi, dan identitas pelaku");
{
  const sheets = {};
  const tb0 = jsonClone(toServer(seed));
  TABLES.forEach((t) => {
    sheets[t] = { rows: tb0[t].map((r) => cols(t).map((c) => r[c] ?? "")) };
  });
  const mkSheet = (t) => ({
    getLastRow: () => sheets[t].rows.length + 1,
    getMaxRows: () => 5e3,
    getMaxColumns: () => 20,
    insertRowsAfter() {
    },
    getRange: (r, c, n, w) => ({
      getValues: () => sheets[t].rows.slice(r - 2, r - 2 + n).map((x) => x.slice(0, w)),
      clearContent: () => {
        sheets[t].rows = [];
      },
      setNumberFormat() {
        return this;
      },
      setValues: (vals) => {
        sheets[t].rows = vals;
      }
    })
  });
  const byName = Object.fromEntries(TABLES.map((t) => [gs.SCHEMA[t].sheet, t]));
  const props = {}, cache = /* @__PURE__ */ new Map();
  const signed = (buf) => [...buf].map((b) => b > 127 ? b - 256 : b);
  Object.assign(gs, {
    LockService: { getScriptLock: () => ({ waitLock() {
    }, releaseLock() {
    } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => {
      props[k] = v;
    }, setProperties: (o) => Object.assign(props, o) }) },
    SpreadsheetApp: { flush() {
    }, getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(byName[n]) }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => cache.get(k) ?? null,
      put: (k, v) => {
        cache.set(k, v);
      },
      remove: (k) => {
        cache.delete(k);
      },
      getAll: (ks) => Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
      putAll: (o) => Object.entries(o).forEach(([k, v]) => cache.set(k, v))
    }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (x) => ({ x, setMimeType() {
      return this;
    } }) },
    Session: { getScriptTimeZone: () => "Asia/Jakarta" },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a, str) => signed(nodeCrypto.createHash("sha256").update(str).digest()),
      computeHmacSha256Signature: (v, key) => signed(nodeCrypto.createHmac("sha256", key).update(v).digest()),
      getUuid: () => nodeCrypto.randomUUID(),
      base64EncodeWebSafe: (str) => Buffer.from(str).toString("base64url"),
      base64DecodeWebSafe: (str) => signed(Buffer.from(str, "base64url")),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => b < 0 ? b + 256 : b)).toString() }),
      formatDate: () => ""
    },
    Logger: { log() {
    } }
  });
  const call = (fn, params, body, token) => JSON.parse(gs.run_(fn, params || {}, body || null, token).x);
  const throws = (fn) => {
    try {
      fn();
      return "";
    } catch (e) {
      return e.message;
    }
  };
  ok(/13 pengguna/.test(gs.aturPasswordSemua("rahasia1")), "password awal diberikan ke semua pengguna");
  ok(gs.aturPasswordSemua("lain1234").startsWith("0 pengguna"), "password awal tidak menimpa yang sudah ada");
  const stored = sheets.U.rows.find((r) => r[0] === "andi.prod")[cols("U").indexOf("pw")];
  ok(/^h1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(stored) && !stored.includes("rahasia1"), "password disimpan sebagai hash bergaram, bukan teks", stored);
  const pws = sheets.U.rows.map((r) => r[cols("U").indexOf("pw")]);
  ok(new Set(pws).size === pws.length, "garam berbeda per pengguna (hash tidak sama walau password sama)");
  ok(/salah/.test(throws(() => gs.login_("andi.prod", "keliru"))), "password salah ditolak");
  ok(/salah/.test(throws(() => gs.login_("tidak.ada", "rahasia1"))), "username tak dikenal ditolak dengan pesan yang sama");
  ok(/Isi username/.test(throws(() => gs.login_("andi.prod", ""))), "password kosong ditolak");
  const lg = gs.login_("  Andi.Prod ", "rahasia1");
  ok(lg.ok && lg.uid === "andi.prod" && lg.token.includes("."), "login benar (huruf besar/spasi diabaikan)");
  ok(gs.checkToken_(lg.token) === "andi.prod", "token sah dikenali");
  for (let i = 0; i < 5; i++) throws(() => gs.login_("siti.prod", "salah" + i));
  ok(/Terlalu banyak/.test(throws(() => gs.login_("siti.prod", "rahasia1"))), "akun terkunci sementara setelah 5 kali gagal (walau password benar)");
  ok(gs.login_("rudi.prod", "rahasia1").ok, "penguncian hanya berlaku untuk akun yang gagal");
  const [pl, sig] = lg.token.split(".");
  ok(gs.checkToken_(pl + "." + "0".repeat(64)) === null, "tanda tangan palsu ditolak");
  const forged = Buffer.from("budi.spv|" + (Date.now() + 1e9)).toString("base64url") + "." + sig;
  ok(gs.checkToken_(forged) === null, "token yang isinya diganti (pindah ke akun lain) ditolak");
  const oldPl = "andi.prod|" + (Date.now() - 1e3);
  ok(gs.checkToken_(Buffer.from(oldPl).toString("base64url") + "." + gs.sign_(oldPl)) === null, "token kedaluwarsa ditolak");
  ok(gs.checkToken_("") === null && gs.checkToken_(void 0) === null && gs.checkToken_("sampah") === null, "token kosong/rusak ditolak");
  ok(call("all").auth === true, "data tidak bisa diambil tanpa login");
  ok(call("all", {}, null, "x.y").auth === true, "data tidak bisa diambil dengan token palsu");
  ok(call("mutate", {}, { ops: [] }).auth === true, "tulis tidak bisa tanpa login");
  ok(call("ver").ok === true, "nomor versi tetap terbuka (tanpa data)");
  const all = call("all", {}, null, lg.token);
  ok(all.ok && all.db.U.length === 13, "data bisa diambil dengan token sah");
  ok(!JSON.stringify(all).includes("h1$") && all.db.U.every((u) => !("pw" in u)), "hash password TIDAK ikut terkirim ke aplikasi");
  const lg2 = call("login", {}, { u: "andi.prod", p: "rahasia1" });
  ok(lg2.ok && lg2.token, "login lewat endpoint berhasil");
  ok(call("login", {}, { u: "andi.prod", p: "x" }).ok === false, "login salah lewat endpoint gagal tanpa token");
  const offIdx = cols("U").indexOf("off");
  sheets.U.rows.find((r) => r[0] === "andi.prod")[offIdx] = "Y";
  gs.bump_(["U"]);
  ok(gs.checkToken_(lg.token) === null, "token pengguna yang dinonaktifkan langsung tidak berlaku");
  ok(/salah/.test(throws(() => gs.login_("andi.prod", "rahasia1"))), "pengguna nonaktif tidak bisa login");
  sheets.U.rows.find((r) => r[0] === "andi.prod")[offIdx] = "";
  gs.bump_(["U"]);
  ok(/lama salah/.test(throws(() => gs.chpw_("andi.prod", "keliru", "baru1234"))), "ganti password: password lama salah ditolak");
  ok(/minimal/.test(throws(() => gs.chpw_("andi.prod", "rahasia1", "123"))), "ganti password: terlalu pendek ditolak");
  ok(call("chpw", {}, { o: "rahasia1", n: "baru1234" }, lg.token).ok, "ganti password lewat endpoint berhasil");
  ok(/salah/.test(throws(() => gs.login_("andi.prod", "rahasia1"))), "password lama tidak berlaku lagi");
  ok(gs.login_("andi.prod", "baru1234").ok, "password baru berlaku");
  ok(call("chpw", {}, { o: "x", n: "baru5678" }).auth === true, "ganti password butuh login");
  gs.resetSesi();
  ok(gs.checkToken_(lg.token) === null, "resetSesi membatalkan semua sesi");
  const pre = jsonClone(toServer(seed));
  pre.U.forEach((u) => u.pw = "h1$abc$" + u.id);
  const upd = { t: "U", op: "set", row: { ...pre.U[0], n: "Nama Baru", pw: "DIBAJAK" } };
  const plan = gs.planOps_(jsonClone(pre), [upd]);
  ok(plan.post.U[0].n === "Nama Baru" && plan.post.U[0].pw === "h1$abc$" + pre.U[0].id, "mengubah pengguna dari klien tidak menyentuh/menimpa hash password");
  const plan2 = gs.planOps_(jsonClone(pre), [{ t: "U", op: "add", row: { id: "z@x.com", n: "Z", dept: "Produksi", role: "User", boss: "budi.spv", hp: "6281200000001", off: "", pw: "DIBAJAK" } }]);
  ok(plan2.post.U.at(-1).pw === "", "pengguna baru dari klien tidak bisa menyelundupkan hash password");
  const ids = (db2, name, ...args) => run(db2, name, ...args).ops;
  const mk = (uid, label, ops, want) => {
    const r = serverApply(seed, ops, null, uid);
    ok(want ? !r.err : !!r.err, label + (want ? " [diterima]" : " [ditolak]"), r.err);
  };
  const opsNew = ids(seed, "saveRequest", { status: "Draft", lines: [kb("KBL-005", 1, 2, addDays(T2, 9))], me: andi });
  mk("andi.prod", "request atas nama sendiri", opsNew, true);
  mk("siti.prod", "request atas nama orang lain", opsNew, false);
  const opsSetuju = ids(seed, "setuju", "RQ-008", "budi.spv");
  mk("budi.spv", "setuju oleh atasan langsung", opsSetuju, true);
  mk("tono.spv", "setuju oleh atasan lain", opsSetuju, false);
  mk("andi.prod", "setuju oleh rekan sekerja", opsSetuju, false);
  const opsBatal = ids(seed, "batal", "RQ-008", "siti.prod");
  mk("siti.prod", "batal oleh pembuat", opsBatal, true);
  mk("budi.spv", "batal oleh atasan (bukan pembuat)", opsBatal, false);
  const opsDtg = ids(seed, "datang", { id: "KON-011", q: 1, l: 0, cat: "", by: "wati.wh" });
  mk("wati.wh", "kedatangan atas nama sendiri", opsDtg, true);
  mk("joko.wh", "kedatangan atas nama rekan", opsDtg, false);
  const opsIng = ids(seed, "ingat", "ITM-015", "wati.wh");
  mk("wati.wh", "pengingat atas nama sendiri", opsIng, true);
  mk("joko.wh", "pengingat atas nama rekan", opsIng, false);
}
console.log(`
${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
