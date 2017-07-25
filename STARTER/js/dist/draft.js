'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

/**
 * SVGInjector v1.1.3 - Fast, caching, dynamic inline SVG DOM injection library
 * https://github.com/iconic/SVGInjector
 *
 * Copyright (c) 2014-2015 Waybury <hello@waybury.com>
 * @license MIT
 */

(function (window, document) {

  'use strict';

  // Environment

  var isLocal = window.location.protocol === 'file:';
  var hasSvgSupport = document.implementation.hasFeature('http://www.w3.org/TR/SVG11/feature#BasicStructure', '1.1');

  function uniqueClasses(list) {
    list = list.split(' ');

    var hash = {};
    var i = list.length;
    var out = [];

    while (i--) {
      if (!hash.hasOwnProperty(list[i])) {
        hash[list[i]] = 1;
        out.unshift(list[i]);
      }
    }

    return out.join(' ');
  }

  /**
   * cache (or polyfill for <= IE8) Array.forEach()
   * source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
   */
  var forEach = Array.prototype.forEach || function (fn, scope) {
    if (this === void 0 || this === null || typeof fn !== 'function') {
      throw new TypeError();
    }

    /* jshint bitwise: false */
    var i,
        len = this.length >>> 0;
    /* jshint bitwise: true */

    for (i = 0; i < len; ++i) {
      if (i in this) {
        fn.call(scope, this[i], i, this);
      }
    }
  };

  // SVG Cache
  var svgCache = {};

  var injectCount = 0;
  var injectedElements = [];

  // Request Queue
  var requestQueue = [];

  // Script running status
  var ranScripts = {};

  var cloneSvg = function cloneSvg(sourceSvg) {
    return sourceSvg.cloneNode(true);
  };

  var queueRequest = function queueRequest(url, callback) {
    requestQueue[url] = requestQueue[url] || [];
    requestQueue[url].push(callback);
  };

  var processRequestQueue = function processRequestQueue(url) {
    for (var i = 0, len = requestQueue[url].length; i < len; i++) {
      // Make these calls async so we avoid blocking the page/renderer
      /* jshint loopfunc: true */
      (function (index) {
        setTimeout(function () {
          requestQueue[url][index](cloneSvg(svgCache[url]));
        }, 0);
      })(i);
      /* jshint loopfunc: false */
    }
  };

  var loadSvg = function loadSvg(url, callback) {
    if (svgCache[url] !== undefined) {
      if (svgCache[url] instanceof SVGSVGElement) {
        // We already have it in cache, so use it
        callback(cloneSvg(svgCache[url]));
      } else {
        // We don't have it in cache yet, but we are loading it, so queue this request
        queueRequest(url, callback);
      }
    } else {

      if (!window.XMLHttpRequest) {
        callback('Browser does not support XMLHttpRequest');
        return false;
      }

      // Seed the cache to indicate we are loading this URL already
      svgCache[url] = {};
      queueRequest(url, callback);

      var httpRequest = new XMLHttpRequest();

      httpRequest.onreadystatechange = function () {
        // readyState 4 = complete
        if (httpRequest.readyState === 4) {

          // Handle status
          if (httpRequest.status === 404 || httpRequest.responseXML === null) {
            callback('Unable to load SVG file: ' + url);

            if (isLocal) callback('Note: SVG injection ajax calls do not work locally without adjusting security setting in your browser. Or consider using a local webserver.');

            callback();
            return false;
          }

          // 200 success from server, or 0 when using file:// protocol locally
          if (httpRequest.status === 200 || isLocal && httpRequest.status === 0) {

            /* globals Document */
            if (httpRequest.responseXML instanceof Document) {
              // Cache it
              svgCache[url] = httpRequest.responseXML.documentElement;
            }
            /* globals -Document */

            // IE9 doesn't create a responseXML Document object from loaded SVG,
            // and throws a "DOM Exception: HIERARCHY_REQUEST_ERR (3)" error when injected.
            //
            // So, we'll just create our own manually via the DOMParser using
            // the the raw XML responseText.
            //
            // :NOTE: IE8 and older doesn't have DOMParser, but they can't do SVG either, so...
            else if (DOMParser && DOMParser instanceof Function) {
                var xmlDoc;
                try {
                  var parser = new DOMParser();
                  xmlDoc = parser.parseFromString(httpRequest.responseText, 'text/xml');
                } catch (e) {
                  xmlDoc = undefined;
                }

                if (!xmlDoc || xmlDoc.getElementsByTagName('parsererror').length) {
                  callback('Unable to parse SVG file: ' + url);
                  return false;
                } else {
                  // Cache it
                  svgCache[url] = xmlDoc.documentElement;
                }
              }

            // We've loaded a new asset, so process any requests waiting for it
            processRequestQueue(url);
          } else {
            callback('There was a problem injecting the SVG: ' + httpRequest.status + ' ' + httpRequest.statusText);
            return false;
          }
        }
      };

      httpRequest.open('GET', url);

      // Treat and parse the response as XML, even if the
      // server sends us a different mimetype
      if (httpRequest.overrideMimeType) httpRequest.overrideMimeType('text/xml');

      httpRequest.send();
    }
  };

  // Inject a single element
  var injectElement = function injectElement(el, evalScripts, pngFallback, callback) {

    // Grab the src or data-src attribute
    var imgUrl = el.getAttribute('data-src') || el.getAttribute('src');

    // We can only inject SVG
    if (!/\.svg/i.test(imgUrl)) {
      callback('Attempted to inject a file with a non-svg extension: ' + imgUrl);
      return;
    }

    // If we don't have SVG support try to fall back to a png,
    // either defined per-element via data-fallback or data-png,
    // or globally via the pngFallback directory setting
    if (!hasSvgSupport) {
      var perElementFallback = el.getAttribute('data-fallback') || el.getAttribute('data-png');

      // Per-element specific PNG fallback defined, so use that
      if (perElementFallback) {
        el.setAttribute('src', perElementFallback);
        callback(null);
      }
      // Global PNG fallback directoriy defined, use the same-named PNG
      else if (pngFallback) {
          el.setAttribute('src', pngFallback + '/' + imgUrl.split('/').pop().replace('.svg', '.png'));
          callback(null);
        }
        // um...
        else {
            callback('This browser does not support SVG and no PNG fallback was defined.');
          }

      return;
    }

    // Make sure we aren't already in the process of injecting this element to
    // avoid a race condition if multiple injections for the same element are run.
    // :NOTE: Using indexOf() only _after_ we check for SVG support and bail,
    // so no need for IE8 indexOf() polyfill
    if (injectedElements.indexOf(el) !== -1) {
      return;
    }

    // Remember the request to inject this element, in case other injection
    // calls are also trying to replace this element before we finish
    injectedElements.push(el);

    // Try to avoid loading the orginal image src if possible.
    el.setAttribute('src', '');

    // Load it up
    loadSvg(imgUrl, function (svg) {

      if (typeof svg === 'undefined' || typeof svg === 'string') {
        callback(svg);
        return false;
      }

      var imgId = el.getAttribute('id');
      if (imgId) {
        svg.setAttribute('id', imgId);
      }

      var imgTitle = el.getAttribute('title');
      if (imgTitle) {
        svg.setAttribute('title', imgTitle);
      }

      // Concat the SVG classes + 'injected-svg' + the img classes
      var classMerge = [].concat(svg.getAttribute('class') || [], 'injected-svg', el.getAttribute('class') || []).join(' ');
      svg.setAttribute('class', uniqueClasses(classMerge));

      var imgStyle = el.getAttribute('style');
      if (imgStyle) {
        svg.setAttribute('style', imgStyle);
      }

      // Copy all the data elements to the svg
      var imgData = [].filter.call(el.attributes, function (at) {
        return (/^data-\w[\w\-]*$/.test(at.name)
        );
      });
      forEach.call(imgData, function (dataAttr) {
        if (dataAttr.name && dataAttr.value) {
          svg.setAttribute(dataAttr.name, dataAttr.value);
        }
      });

      // Make sure any internally referenced clipPath ids and their
      // clip-path references are unique.
      //
      // This addresses the issue of having multiple instances of the
      // same SVG on a page and only the first clipPath id is referenced.
      //
      // Browsers often shortcut the SVG Spec and don't use clipPaths
      // contained in parent elements that are hidden, so if you hide the first
      // SVG instance on the page, then all other instances lose their clipping.
      // Reference: https://bugzilla.mozilla.org/show_bug.cgi?id=376027

      // Handle all defs elements that have iri capable attributes as defined by w3c: http://www.w3.org/TR/SVG/linking.html#processingIRI
      // Mapping IRI addressable elements to the properties that can reference them:
      var iriElementsAndProperties = {
        'clipPath': ['clip-path'],
        'color-profile': ['color-profile'],
        'cursor': ['cursor'],
        'filter': ['filter'],
        'linearGradient': ['fill', 'stroke'],
        'marker': ['marker', 'marker-start', 'marker-mid', 'marker-end'],
        'mask': ['mask'],
        'pattern': ['fill', 'stroke'],
        'radialGradient': ['fill', 'stroke']
      };

      var element, elementDefs, properties, currentId, newId;
      Object.keys(iriElementsAndProperties).forEach(function (key) {
        element = key;
        properties = iriElementsAndProperties[key];

        elementDefs = svg.querySelectorAll('defs ' + element + '[id]');
        for (var i = 0, elementsLen = elementDefs.length; i < elementsLen; i++) {
          currentId = elementDefs[i].id;
          newId = currentId + '-' + injectCount;

          // All of the properties that can reference this element type
          var referencingElements;
          forEach.call(properties, function (property) {
            // :NOTE: using a substring match attr selector here to deal with IE "adding extra quotes in url() attrs"
            referencingElements = svg.querySelectorAll('[' + property + '*="' + currentId + '"]');
            for (var j = 0, referencingElementLen = referencingElements.length; j < referencingElementLen; j++) {
              referencingElements[j].setAttribute(property, 'url(#' + newId + ')');
            }
          });

          elementDefs[i].id = newId;
        }
      });

      // Remove any unwanted/invalid namespaces that might have been added by SVG editing tools
      svg.removeAttribute('xmlns:a');

      // Post page load injected SVGs don't automatically have their script
      // elements run, so we'll need to make that happen, if requested

      // Find then prune the scripts
      var scripts = svg.querySelectorAll('script');
      var scriptsToEval = [];
      var script, scriptType;

      for (var k = 0, scriptsLen = scripts.length; k < scriptsLen; k++) {
        scriptType = scripts[k].getAttribute('type');

        // Only process javascript types.
        // SVG defaults to 'application/ecmascript' for unset types
        if (!scriptType || scriptType === 'application/ecmascript' || scriptType === 'application/javascript') {

          // innerText for IE, textContent for other browsers
          script = scripts[k].innerText || scripts[k].textContent;

          // Stash
          scriptsToEval.push(script);

          // Tidy up and remove the script element since we don't need it anymore
          svg.removeChild(scripts[k]);
        }
      }

      // Run/Eval the scripts if needed
      if (scriptsToEval.length > 0 && (evalScripts === 'always' || evalScripts === 'once' && !ranScripts[imgUrl])) {
        for (var l = 0, scriptsToEvalLen = scriptsToEval.length; l < scriptsToEvalLen; l++) {

          // :NOTE: Yup, this is a form of eval, but it is being used to eval code
          // the caller has explictely asked to be loaded, and the code is in a caller
          // defined SVG file... not raw user input.
          //
          // Also, the code is evaluated in a closure and not in the global scope.
          // If you need to put something in global scope, use 'window'
          new Function(scriptsToEval[l])(window); // jshint ignore:line
        }

        // Remember we already ran scripts for this svg
        ranScripts[imgUrl] = true;
      }

      // :WORKAROUND:
      // IE doesn't evaluate <style> tags in SVGs that are dynamically added to the page.
      // This trick will trigger IE to read and use any existing SVG <style> tags.
      //
      // Reference: https://github.com/iconic/SVGInjector/issues/23
      var styleTags = svg.querySelectorAll('style');
      forEach.call(styleTags, function (styleTag) {
        styleTag.textContent += '';
      });

      // Replace the image with the svg
      el.parentNode.replaceChild(svg, el);

      // Now that we no longer need it, drop references
      // to the original element so it can be GC'd
      delete injectedElements[injectedElements.indexOf(el)];
      el = null;

      // Increment the injected count
      injectCount++;

      callback(svg);
    });
  };

  /**
   * SVGInjector
   *
   * Replace the given elements with their full inline SVG DOM elements.
   *
   * :NOTE: We are using get/setAttribute with SVG because the SVG DOM spec differs from HTML DOM and
   * can return other unexpected object types when trying to directly access svg properties.
   * ex: "className" returns a SVGAnimatedString with the class value found in the "baseVal" property,
   * instead of simple string like with HTML Elements.
   *
   * @param {mixes} Array of or single DOM element
   * @param {object} options
   * @param {function} callback
   * @return {object} Instance of SVGInjector
   */
  var SVGInjector = function SVGInjector(elements, options, done) {

    // Options & defaults
    options = options || {};

    // Should we run the scripts blocks found in the SVG
    // 'always' - Run them every time
    // 'once' - Only run scripts once for each SVG
    // [false|'never'] - Ignore scripts
    var evalScripts = options.evalScripts || 'always';

    // Location of fallback pngs, if desired
    var pngFallback = options.pngFallback || false;

    // Callback to run during each SVG injection, returning the SVG injected
    var eachCallback = options.each;

    // Do the injection...
    if (elements.length !== undefined) {
      var elementsLoaded = 0;
      forEach.call(elements, function (element) {
        injectElement(element, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done && elements.length === ++elementsLoaded) done(elementsLoaded);
        });
      });
    } else {
      if (elements) {
        injectElement(elements, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done) done(1);
          elements = null;
        });
      } else {
        if (done) done(0);
      }
    }
  };

  /* global module, exports: true, define */
  // Node.js or CommonJS
  if ((typeof module === 'undefined' ? 'undefined' : _typeof(module)) === 'object' && _typeof(module.exports) === 'object') {
    module.exports = exports = SVGInjector;
  }
  // AMD support
  else if (typeof define === 'function' && define.amd) {
      define(function () {
        return SVGInjector;
      });
    }
    // Otherwise, attach to window as global
    else if ((typeof window === 'undefined' ? 'undefined' : _typeof(window)) === 'object') {
        window.SVGInjector = SVGInjector;
      }
  /* global -module, -exports, -define */
})(window, document);
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Foundation = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _jquery = require('jquery');

var _jquery2 = _interopRequireDefault(_jquery);

var _foundationUtil = require('./foundation.util.core');

var _foundationUtil2 = require('./foundation.util.mediaQuery');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var FOUNDATION_VERSION = '6.4.1';

// Global Foundation object
// This is attached to the window, or used as a module for AMD/Browserify
var Foundation = {
  version: FOUNDATION_VERSION,

  /**
   * Stores initialized plugins.
   */
  _plugins: {},

  /**
   * Stores generated unique ids for plugin instances
   */
  _uuids: [],

  /**
   * Defines a Foundation plugin, adding it to the `Foundation` namespace and the list of plugins to initialize when reflowing.
   * @param {Object} plugin - The constructor of the plugin.
   */
  plugin: function plugin(_plugin, name) {
    // Object key to use when adding to global Foundation object
    // Examples: Foundation.Reveal, Foundation.OffCanvas
    var className = name || functionName(_plugin);
    // Object key to use when storing the plugin, also used to create the identifying data attribute for the plugin
    // Examples: data-reveal, data-off-canvas
    var attrName = hyphenate(className);

    // Add to the Foundation object and the plugins list (for reflowing)
    this._plugins[attrName] = this[className] = _plugin;
  },
  /**
   * @function
   * Populates the _uuids array with pointers to each individual plugin instance.
   * Adds the `zfPlugin` data-attribute to programmatically created plugins to allow use of $(selector).foundation(method) calls.
   * Also fires the initialization event for each plugin, consolidating repetitive code.
   * @param {Object} plugin - an instance of a plugin, usually `this` in context.
   * @param {String} name - the name of the plugin, passed as a camelCased string.
   * @fires Plugin#init
   */
  registerPlugin: function registerPlugin(plugin, name) {
    var pluginName = name ? hyphenate(name) : functionName(plugin.constructor).toLowerCase();
    plugin.uuid = (0, _foundationUtil.GetYoDigits)(6, pluginName);

    if (!plugin.$element.attr('data-' + pluginName)) {
      plugin.$element.attr('data-' + pluginName, plugin.uuid);
    }
    if (!plugin.$element.data('zfPlugin')) {
      plugin.$element.data('zfPlugin', plugin);
    }
    /**
     * Fires when the plugin has initialized.
     * @event Plugin#init
     */
    plugin.$element.trigger('init.zf.' + pluginName);

    this._uuids.push(plugin.uuid);

    return;
  },
  /**
   * @function
   * Removes the plugins uuid from the _uuids array.
   * Removes the zfPlugin data attribute, as well as the data-plugin-name attribute.
   * Also fires the destroyed event for the plugin, consolidating repetitive code.
   * @param {Object} plugin - an instance of a plugin, usually `this` in context.
   * @fires Plugin#destroyed
   */
  unregisterPlugin: function unregisterPlugin(plugin) {
    var pluginName = hyphenate(functionName(plugin.$element.data('zfPlugin').constructor));

    this._uuids.splice(this._uuids.indexOf(plugin.uuid), 1);
    plugin.$element.removeAttr('data-' + pluginName).removeData('zfPlugin')
    /**
     * Fires when the plugin has been destroyed.
     * @event Plugin#destroyed
     */
    .trigger('destroyed.zf.' + pluginName);
    for (var prop in plugin) {
      plugin[prop] = null; //clean up script to prep for garbage collection.
    }
    return;
  },

  /**
   * @function
   * Causes one or more active plugins to re-initialize, resetting event listeners, recalculating positions, etc.
   * @param {String} plugins - optional string of an individual plugin key, attained by calling `$(element).data('pluginName')`, or string of a plugin class i.e. `'dropdown'`
   * @default If no argument is passed, reflow all currently active plugins.
   */
  reInit: function reInit(plugins) {
    var isJQ = plugins instanceof _jquery2.default;
    try {
      if (isJQ) {
        plugins.each(function () {
          (0, _jquery2.default)(this).data('zfPlugin')._init();
        });
      } else {
        var type = typeof plugins === 'undefined' ? 'undefined' : _typeof(plugins),
            _this = this,
            fns = {
          'object': function object(plgs) {
            plgs.forEach(function (p) {
              p = hyphenate(p);
              (0, _jquery2.default)('[data-' + p + ']').foundation('_init');
            });
          },
          'string': function string() {
            plugins = hyphenate(plugins);
            (0, _jquery2.default)('[data-' + plugins + ']').foundation('_init');
          },
          'undefined': function undefined() {
            this['object'](Object.keys(_this._plugins));
          }
        };
        fns[type](plugins);
      }
    } catch (err) {
      console.error(err);
    } finally {
      return plugins;
    }
  },

  /**
   * Initialize plugins on any elements within `elem` (and `elem` itself) that aren't already initialized.
   * @param {Object} elem - jQuery object containing the element to check inside. Also checks the element itself, unless it's the `document` object.
   * @param {String|Array} plugins - A list of plugins to initialize. Leave this out to initialize everything.
   */
  reflow: function reflow(elem, plugins) {

    // If plugins is undefined, just grab everything
    if (typeof plugins === 'undefined') {
      plugins = Object.keys(this._plugins);
    }
    // If plugins is a string, convert it to an array with one item
    else if (typeof plugins === 'string') {
        plugins = [plugins];
      }

    var _this = this;

    // Iterate through each plugin
    _jquery2.default.each(plugins, function (i, name) {
      // Get the current plugin
      var plugin = _this._plugins[name];

      // Localize the search to all elements inside elem, as well as elem itself, unless elem === document
      var $elem = (0, _jquery2.default)(elem).find('[data-' + name + ']').addBack('[data-' + name + ']');

      // For each plugin found, initialize it
      $elem.each(function () {
        var $el = (0, _jquery2.default)(this),
            opts = {};
        // Don't double-dip on plugins
        if ($el.data('zfPlugin')) {
          console.warn("Tried to initialize " + name + " on an element that already has a Foundation plugin.");
          return;
        }

        if ($el.attr('data-options')) {
          var thing = $el.attr('data-options').split(';').forEach(function (e, i) {
            var opt = e.split(':').map(function (el) {
              return el.trim();
            });
            if (opt[0]) opts[opt[0]] = parseValue(opt[1]);
          });
        }
        try {
          $el.data('zfPlugin', new plugin((0, _jquery2.default)(this), opts));
        } catch (er) {
          console.error(er);
        } finally {
          return;
        }
      });
    });
  },
  getFnName: functionName,

  addToJquery: function addToJquery($) {
    // TODO: consider not making this a jQuery function
    // TODO: need way to reflow vs. re-initialize
    /**
     * The Foundation jQuery method.
     * @param {String|Array} method - An action to perform on the current jQuery object.
     */
    var foundation = function foundation(method) {
      var type = typeof method === 'undefined' ? 'undefined' : _typeof(method),
          $noJS = $('.no-js');

      if ($noJS.length) {
        $noJS.removeClass('no-js');
      }

      if (type === 'undefined') {
        //needs to initialize the Foundation object, or an individual plugin.
        _foundationUtil2.MediaQuery._init();
        Foundation.reflow(this);
      } else if (type === 'string') {
        //an individual method to invoke on a plugin or group of plugins
        var args = Array.prototype.slice.call(arguments, 1); //collect all the arguments, if necessary
        var plugClass = this.data('zfPlugin'); //determine the class of plugin

        if (plugClass !== undefined && plugClass[method] !== undefined) {
          //make sure both the class and method exist
          if (this.length === 1) {
            //if there's only one, call it directly.
            plugClass[method].apply(plugClass, args);
          } else {
            this.each(function (i, el) {
              //otherwise loop through the jQuery collection and invoke the method on each
              plugClass[method].apply($(el).data('zfPlugin'), args);
            });
          }
        } else {
          //error for no class or no method
          throw new ReferenceError("We're sorry, '" + method + "' is not an available method for " + (plugClass ? functionName(plugClass) : 'this element') + '.');
        }
      } else {
        //error for invalid argument type
        throw new TypeError('We\'re sorry, ' + type + ' is not a valid parameter. You must use a string representing the method you wish to invoke.');
      }
      return this;
    };
    $.fn.foundation = foundation;
    return $;
  }
};

Foundation.util = {
  /**
   * Function for applying a debounce effect to a function call.
   * @function
   * @param {Function} func - Function to be called at end of timeout.
   * @param {Number} delay - Time in ms to delay the call of `func`.
   * @returns function
   */
  throttle: function throttle(func, delay) {
    var timer = null;

    return function () {
      var context = this,
          args = arguments;

      if (timer === null) {
        timer = setTimeout(function () {
          func.apply(context, args);
          timer = null;
        }, delay);
      }
    };
  }
};

window.Foundation = Foundation;

// Polyfill for requestAnimationFrame
(function () {
  if (!Date.now || !window.Date.now) window.Date.now = Date.now = function () {
    return new Date().getTime();
  };

  var vendors = ['webkit', 'moz'];
  for (var i = 0; i < vendors.length && !window.requestAnimationFrame; ++i) {
    var vp = vendors[i];
    window.requestAnimationFrame = window[vp + 'RequestAnimationFrame'];
    window.cancelAnimationFrame = window[vp + 'CancelAnimationFrame'] || window[vp + 'CancelRequestAnimationFrame'];
  }
  if (/iP(ad|hone|od).*OS 6/.test(window.navigator.userAgent) || !window.requestAnimationFrame || !window.cancelAnimationFrame) {
    var lastTime = 0;
    window.requestAnimationFrame = function (callback) {
      var now = Date.now();
      var nextTime = Math.max(lastTime + 16, now);
      return setTimeout(function () {
        callback(lastTime = nextTime);
      }, nextTime - now);
    };
    window.cancelAnimationFrame = clearTimeout;
  }
  /**
   * Polyfill for performance.now, required by rAF
   */
  if (!window.performance || !window.performance.now) {
    window.performance = {
      start: Date.now(),
      now: function now() {
        return Date.now() - this.start;
      }
    };
  }
})();
if (!Function.prototype.bind) {
  Function.prototype.bind = function (oThis) {
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5
      // internal IsCallable function
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
    }

    var aArgs = Array.prototype.slice.call(arguments, 1),
        fToBind = this,
        fNOP = function fNOP() {},
        fBound = function fBound() {
      return fToBind.apply(this instanceof fNOP ? this : oThis, aArgs.concat(Array.prototype.slice.call(arguments)));
    };

    if (this.prototype) {
      // native functions don't have a prototype
      fNOP.prototype = this.prototype;
    }
    fBound.prototype = new fNOP();

    return fBound;
  };
}
// Polyfill to get the name of a function in IE9
function functionName(fn) {
  if (Function.prototype.name === undefined) {
    var funcNameRegex = /function\s([^(]{1,})\(/;
    var results = funcNameRegex.exec(fn.toString());
    return results && results.length > 1 ? results[1].trim() : "";
  } else if (fn.prototype === undefined) {
    return fn.constructor.name;
  } else {
    return fn.prototype.constructor.name;
  }
}
function parseValue(str) {
  if ('true' === str) return true;else if ('false' === str) return false;else if (!isNaN(str * 1)) return parseFloat(str);
  return str;
}
// Convert PascalCase to kebab-case
// Thank you: http://stackoverflow.com/a/8955580
function hyphenate(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

exports.Foundation = Foundation;
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MediaQuery = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _jquery = require('jquery');

var _jquery2 = _interopRequireDefault(_jquery);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// Default set of media queries
var defaultQueries = {
  'default': 'only screen',
  landscape: 'only screen and (orientation: landscape)',
  portrait: 'only screen and (orientation: portrait)',
  retina: 'only screen and (-webkit-min-device-pixel-ratio: 2),' + 'only screen and (min--moz-device-pixel-ratio: 2),' + 'only screen and (-o-min-device-pixel-ratio: 2/1),' + 'only screen and (min-device-pixel-ratio: 2),' + 'only screen and (min-resolution: 192dpi),' + 'only screen and (min-resolution: 2dppx)'
};

// matchMedia() polyfill - Test a CSS media type/query in JS.
// Authors & copyright (c) 2012: Scott Jehl, Paul Irish, Nicholas Zakas, David Knight. Dual MIT/BSD license
var matchMedia = window.matchMedia || function () {
  'use strict';

  // For browsers that support matchMedium api such as IE 9 and webkit

  var styleMedia = window.styleMedia || window.media;

  // For those that don't support matchMedium
  if (!styleMedia) {
    var style = document.createElement('style'),
        script = document.getElementsByTagName('script')[0],
        info = null;

    style.type = 'text/css';
    style.id = 'matchmediajs-test';

    script && script.parentNode && script.parentNode.insertBefore(style, script);

    // 'style.currentStyle' is used by IE <= 8 and 'window.getComputedStyle' for all other browsers
    info = 'getComputedStyle' in window && window.getComputedStyle(style, null) || style.currentStyle;

    styleMedia = {
      matchMedium: function matchMedium(media) {
        var text = '@media ' + media + '{ #matchmediajs-test { width: 1px; } }';

        // 'style.styleSheet' is used by IE <= 8 and 'style.textContent' for all other browsers
        if (style.styleSheet) {
          style.styleSheet.cssText = text;
        } else {
          style.textContent = text;
        }

        // Test if media query is true or false
        return info.width === '1px';
      }
    };
  }

  return function (media) {
    return {
      matches: styleMedia.matchMedium(media || 'all'),
      media: media || 'all'
    };
  };
}();

var MediaQuery = {
  queries: [],

  current: '',

  /**
   * Initializes the media query helper, by extracting the breakpoint list from the CSS and activating the breakpoint watcher.
   * @function
   * @private
   */
  _init: function _init() {
    var self = this;
    var $meta = (0, _jquery2.default)('meta.foundation-mq');
    if (!$meta.length) {
      (0, _jquery2.default)('<meta class="foundation-mq">').appendTo(document.head);
    }

    var extractedStyles = (0, _jquery2.default)('.foundation-mq').css('font-family');
    var namedQueries;

    namedQueries = parseStyleToObject(extractedStyles);

    for (var key in namedQueries) {
      if (namedQueries.hasOwnProperty(key)) {
        self.queries.push({
          name: key,
          value: 'only screen and (min-width: ' + namedQueries[key] + ')'
        });
      }
    }

    this.current = this._getCurrentSize();

    this._watcher();
  },


  /**
   * Checks if the screen is at least as wide as a breakpoint.
   * @function
   * @param {String} size - Name of the breakpoint to check.
   * @returns {Boolean} `true` if the breakpoint matches, `false` if it's smaller.
   */
  atLeast: function atLeast(size) {
    var query = this.get(size);

    if (query) {
      return matchMedia(query).matches;
    }

    return false;
  },


  /**
   * Checks if the screen matches to a breakpoint.
   * @function
   * @param {String} size - Name of the breakpoint to check, either 'small only' or 'small'. Omitting 'only' falls back to using atLeast() method.
   * @returns {Boolean} `true` if the breakpoint matches, `false` if it does not.
   */
  is: function is(size) {
    size = size.trim().split(' ');
    if (size.length > 1 && size[1] === 'only') {
      if (size[0] === this._getCurrentSize()) return true;
    } else {
      return this.atLeast(size[0]);
    }
    return false;
  },


  /**
   * Gets the media query of a breakpoint.
   * @function
   * @param {String} size - Name of the breakpoint to get.
   * @returns {String|null} - The media query of the breakpoint, or `null` if the breakpoint doesn't exist.
   */
  get: function get(size) {
    for (var i in this.queries) {
      if (this.queries.hasOwnProperty(i)) {
        var query = this.queries[i];
        if (size === query.name) return query.value;
      }
    }

    return null;
  },


  /**
   * Gets the current breakpoint name by testing every breakpoint and returning the last one to match (the biggest one).
   * @function
   * @private
   * @returns {String} Name of the current breakpoint.
   */
  _getCurrentSize: function _getCurrentSize() {
    var matched;

    for (var i = 0; i < this.queries.length; i++) {
      var query = this.queries[i];

      if (matchMedia(query.value).matches) {
        matched = query;
      }
    }

    if ((typeof matched === 'undefined' ? 'undefined' : _typeof(matched)) === 'object') {
      return matched.name;
    } else {
      return matched;
    }
  },


  /**
   * Activates the breakpoint watcher, which fires an event on the window whenever the breakpoint changes.
   * @function
   * @private
   */
  _watcher: function _watcher() {
    var _this = this;

    (0, _jquery2.default)(window).off('resize.zf.mediaquery').on('resize.zf.mediaquery', function () {
      var newSize = _this._getCurrentSize(),
          currentSize = _this.current;

      if (newSize !== currentSize) {
        // Change the current media query
        _this.current = newSize;

        // Broadcast the media query change on the window
        (0, _jquery2.default)(window).trigger('changed.zf.mediaquery', [newSize, currentSize]);
      }
    });
  }
};

// Thank you: https://github.com/sindresorhus/query-string
function parseStyleToObject(str) {
  var styleObject = {};

  if (typeof str !== 'string') {
    return styleObject;
  }

  str = str.trim().slice(1, -1); // browsers re-quote string style values

  if (!str) {
    return styleObject;
  }

  styleObject = str.split('&').reduce(function (ret, param) {
    var parts = param.replace(/\+/g, ' ').split('=');
    var key = parts[0];
    var val = parts[1];
    key = decodeURIComponent(key);

    // missing `=` should be `null`:
    // http://w3.org/TR/2012/WD-url-20120524/#collect-url-parameters
    val = val === undefined ? null : decodeURIComponent(val);

    if (!ret.hasOwnProperty(key)) {
      ret[key] = val;
    } else if (Array.isArray(ret[key])) {
      ret[key].push(val);
    } else {
      ret[key] = [ret[key], val];
    }
    return ret;
  }, {});

  return styleObject;
}

exports.MediaQuery = MediaQuery;
"use strict";

/**
 * @file inject-svg.js
 *
 * Use svg-injector.js to replace an svg <img> tag with the inline svg.
 */

(function ($, document) {
  "use strict";

  $(function () {
    // Elements to inject
    var mySVGsToInject = document.querySelectorAll('img.inject-me');

    // Do the injection
    /* global SVGInjector */
    new SVGInjector(mySVGsToInject);
  });
})(jQuery, document);
"use strict";

/**
 * theme.js
 * Entry point for all theme related js.
 */

(function ($) {
  "use strict";

  $(function () {});
})(jQuery);
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInN2Zy1pbmplY3Rvci5qcyIsImZvdW5kYXRpb24uY29yZS5qcyIsImZvdW5kYXRpb24udXRpbC5tZWRpYVF1ZXJ5LmpzIiwiaW5qZWN0LXN2Zy5qcyIsInRoZW1lLmpzIl0sIm5hbWVzIjpbIndpbmRvdyIsImRvY3VtZW50IiwiaXNMb2NhbCIsImxvY2F0aW9uIiwicHJvdG9jb2wiLCJoYXNTdmdTdXBwb3J0IiwiaW1wbGVtZW50YXRpb24iLCJoYXNGZWF0dXJlIiwidW5pcXVlQ2xhc3NlcyIsImxpc3QiLCJzcGxpdCIsImhhc2giLCJpIiwibGVuZ3RoIiwib3V0IiwiaGFzT3duUHJvcGVydHkiLCJ1bnNoaWZ0Iiwiam9pbiIsImZvckVhY2giLCJBcnJheSIsInByb3RvdHlwZSIsImZuIiwic2NvcGUiLCJUeXBlRXJyb3IiLCJsZW4iLCJjYWxsIiwic3ZnQ2FjaGUiLCJpbmplY3RDb3VudCIsImluamVjdGVkRWxlbWVudHMiLCJyZXF1ZXN0UXVldWUiLCJyYW5TY3JpcHRzIiwiY2xvbmVTdmciLCJzb3VyY2VTdmciLCJjbG9uZU5vZGUiLCJxdWV1ZVJlcXVlc3QiLCJ1cmwiLCJjYWxsYmFjayIsInB1c2giLCJwcm9jZXNzUmVxdWVzdFF1ZXVlIiwiaW5kZXgiLCJzZXRUaW1lb3V0IiwibG9hZFN2ZyIsInVuZGVmaW5lZCIsIlNWR1NWR0VsZW1lbnQiLCJYTUxIdHRwUmVxdWVzdCIsImh0dHBSZXF1ZXN0Iiwib25yZWFkeXN0YXRlY2hhbmdlIiwicmVhZHlTdGF0ZSIsInN0YXR1cyIsInJlc3BvbnNlWE1MIiwiRG9jdW1lbnQiLCJkb2N1bWVudEVsZW1lbnQiLCJET01QYXJzZXIiLCJGdW5jdGlvbiIsInhtbERvYyIsInBhcnNlciIsInBhcnNlRnJvbVN0cmluZyIsInJlc3BvbnNlVGV4dCIsImUiLCJnZXRFbGVtZW50c0J5VGFnTmFtZSIsInN0YXR1c1RleHQiLCJvcGVuIiwib3ZlcnJpZGVNaW1lVHlwZSIsInNlbmQiLCJpbmplY3RFbGVtZW50IiwiZWwiLCJldmFsU2NyaXB0cyIsInBuZ0ZhbGxiYWNrIiwiaW1nVXJsIiwiZ2V0QXR0cmlidXRlIiwidGVzdCIsInBlckVsZW1lbnRGYWxsYmFjayIsInNldEF0dHJpYnV0ZSIsInBvcCIsInJlcGxhY2UiLCJpbmRleE9mIiwic3ZnIiwiaW1nSWQiLCJpbWdUaXRsZSIsImNsYXNzTWVyZ2UiLCJjb25jYXQiLCJpbWdTdHlsZSIsImltZ0RhdGEiLCJmaWx0ZXIiLCJhdHRyaWJ1dGVzIiwiYXQiLCJuYW1lIiwiZGF0YUF0dHIiLCJ2YWx1ZSIsImlyaUVsZW1lbnRzQW5kUHJvcGVydGllcyIsImVsZW1lbnQiLCJlbGVtZW50RGVmcyIsInByb3BlcnRpZXMiLCJjdXJyZW50SWQiLCJuZXdJZCIsIk9iamVjdCIsImtleXMiLCJrZXkiLCJxdWVyeVNlbGVjdG9yQWxsIiwiZWxlbWVudHNMZW4iLCJpZCIsInJlZmVyZW5jaW5nRWxlbWVudHMiLCJwcm9wZXJ0eSIsImoiLCJyZWZlcmVuY2luZ0VsZW1lbnRMZW4iLCJyZW1vdmVBdHRyaWJ1dGUiLCJzY3JpcHRzIiwic2NyaXB0c1RvRXZhbCIsInNjcmlwdCIsInNjcmlwdFR5cGUiLCJrIiwic2NyaXB0c0xlbiIsImlubmVyVGV4dCIsInRleHRDb250ZW50IiwicmVtb3ZlQ2hpbGQiLCJsIiwic2NyaXB0c1RvRXZhbExlbiIsInN0eWxlVGFncyIsInN0eWxlVGFnIiwicGFyZW50Tm9kZSIsInJlcGxhY2VDaGlsZCIsIlNWR0luamVjdG9yIiwiZWxlbWVudHMiLCJvcHRpb25zIiwiZG9uZSIsImVhY2hDYWxsYmFjayIsImVhY2giLCJlbGVtZW50c0xvYWRlZCIsIm1vZHVsZSIsImV4cG9ydHMiLCJkZWZpbmUiLCJhbWQiLCJGT1VOREFUSU9OX1ZFUlNJT04iLCJGb3VuZGF0aW9uIiwidmVyc2lvbiIsIl9wbHVnaW5zIiwiX3V1aWRzIiwicGx1Z2luIiwiY2xhc3NOYW1lIiwiZnVuY3Rpb25OYW1lIiwiYXR0ck5hbWUiLCJoeXBoZW5hdGUiLCJyZWdpc3RlclBsdWdpbiIsInBsdWdpbk5hbWUiLCJjb25zdHJ1Y3RvciIsInRvTG93ZXJDYXNlIiwidXVpZCIsIiRlbGVtZW50IiwiYXR0ciIsImRhdGEiLCJ0cmlnZ2VyIiwidW5yZWdpc3RlclBsdWdpbiIsInNwbGljZSIsInJlbW92ZUF0dHIiLCJyZW1vdmVEYXRhIiwicHJvcCIsInJlSW5pdCIsInBsdWdpbnMiLCJpc0pRIiwiX2luaXQiLCJ0eXBlIiwiX3RoaXMiLCJmbnMiLCJwbGdzIiwicCIsImZvdW5kYXRpb24iLCJlcnIiLCJjb25zb2xlIiwiZXJyb3IiLCJyZWZsb3ciLCJlbGVtIiwiJGVsZW0iLCJmaW5kIiwiYWRkQmFjayIsIiRlbCIsIm9wdHMiLCJ3YXJuIiwidGhpbmciLCJvcHQiLCJtYXAiLCJ0cmltIiwicGFyc2VWYWx1ZSIsImVyIiwiZ2V0Rm5OYW1lIiwiYWRkVG9KcXVlcnkiLCIkIiwibWV0aG9kIiwiJG5vSlMiLCJyZW1vdmVDbGFzcyIsImFyZ3MiLCJzbGljZSIsImFyZ3VtZW50cyIsInBsdWdDbGFzcyIsImFwcGx5IiwiUmVmZXJlbmNlRXJyb3IiLCJ1dGlsIiwidGhyb3R0bGUiLCJmdW5jIiwiZGVsYXkiLCJ0aW1lciIsImNvbnRleHQiLCJEYXRlIiwibm93IiwiZ2V0VGltZSIsInZlbmRvcnMiLCJyZXF1ZXN0QW5pbWF0aW9uRnJhbWUiLCJ2cCIsImNhbmNlbEFuaW1hdGlvbkZyYW1lIiwibmF2aWdhdG9yIiwidXNlckFnZW50IiwibGFzdFRpbWUiLCJuZXh0VGltZSIsIk1hdGgiLCJtYXgiLCJjbGVhclRpbWVvdXQiLCJwZXJmb3JtYW5jZSIsInN0YXJ0IiwiYmluZCIsIm9UaGlzIiwiYUFyZ3MiLCJmVG9CaW5kIiwiZk5PUCIsImZCb3VuZCIsImZ1bmNOYW1lUmVnZXgiLCJyZXN1bHRzIiwiZXhlYyIsInRvU3RyaW5nIiwic3RyIiwiaXNOYU4iLCJwYXJzZUZsb2F0IiwiZGVmYXVsdFF1ZXJpZXMiLCJsYW5kc2NhcGUiLCJwb3J0cmFpdCIsInJldGluYSIsIm1hdGNoTWVkaWEiLCJzdHlsZU1lZGlhIiwibWVkaWEiLCJzdHlsZSIsImNyZWF0ZUVsZW1lbnQiLCJpbmZvIiwiaW5zZXJ0QmVmb3JlIiwiZ2V0Q29tcHV0ZWRTdHlsZSIsImN1cnJlbnRTdHlsZSIsIm1hdGNoTWVkaXVtIiwidGV4dCIsInN0eWxlU2hlZXQiLCJjc3NUZXh0Iiwid2lkdGgiLCJtYXRjaGVzIiwiTWVkaWFRdWVyeSIsInF1ZXJpZXMiLCJjdXJyZW50Iiwic2VsZiIsIiRtZXRhIiwiYXBwZW5kVG8iLCJoZWFkIiwiZXh0cmFjdGVkU3R5bGVzIiwiY3NzIiwibmFtZWRRdWVyaWVzIiwicGFyc2VTdHlsZVRvT2JqZWN0IiwiX2dldEN1cnJlbnRTaXplIiwiX3dhdGNoZXIiLCJhdExlYXN0Iiwic2l6ZSIsInF1ZXJ5IiwiZ2V0IiwiaXMiLCJtYXRjaGVkIiwib2ZmIiwib24iLCJuZXdTaXplIiwiY3VycmVudFNpemUiLCJzdHlsZU9iamVjdCIsInJlZHVjZSIsInJldCIsInBhcmFtIiwicGFydHMiLCJ2YWwiLCJkZWNvZGVVUklDb21wb25lbnQiLCJpc0FycmF5IiwibXlTVkdzVG9JbmplY3QiLCJqUXVlcnkiXSwibWFwcGluZ3MiOiI7Ozs7QUFBQTs7Ozs7Ozs7QUFRQyxXQUFVQSxNQUFWLEVBQWtCQyxRQUFsQixFQUE0Qjs7QUFFM0I7O0FBRUE7O0FBQ0EsTUFBSUMsVUFBVUYsT0FBT0csUUFBUCxDQUFnQkMsUUFBaEIsS0FBNkIsT0FBM0M7QUFDQSxNQUFJQyxnQkFBZ0JKLFNBQVNLLGNBQVQsQ0FBd0JDLFVBQXhCLENBQW1DLG1EQUFuQyxFQUF3RixLQUF4RixDQUFwQjs7QUFFQSxXQUFTQyxhQUFULENBQXVCQyxJQUF2QixFQUE2QjtBQUMzQkEsV0FBT0EsS0FBS0MsS0FBTCxDQUFXLEdBQVgsQ0FBUDs7QUFFQSxRQUFJQyxPQUFPLEVBQVg7QUFDQSxRQUFJQyxJQUFJSCxLQUFLSSxNQUFiO0FBQ0EsUUFBSUMsTUFBTSxFQUFWOztBQUVBLFdBQU9GLEdBQVAsRUFBWTtBQUNWLFVBQUksQ0FBQ0QsS0FBS0ksY0FBTCxD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V0FBUDtBQUNEOztRQUVPdkIsYUFBQUE7OztBQ3pPUjs7Ozs7O0FBTUEsQ0FBQyxVQUFTaEUsQ0FBVCxFQUFZeEwsUUFBWixFQUFxQjtBQUNwQjs7QUFFQXdMLElBQUUsWUFBTTtBQUNOO0FBQ0EsUUFBSStGLGlCQUFpQnZSLFNBQVNpRyxnQkFBVCxDQUEwQixlQUExQixDQUFyQjs7QUFFQTtBQUNBO0FBQ0EsUUFBSXVCLFdBQUosQ0FBZ0IrSixjQUFoQjtBQUNELEdBUEQ7QUFTRCxDQVpELEVBWUdDLE1BWkgsRUFZV3hSLFFBWlg7OztBQ05BOzs7OztBQUtBLENBQUMsVUFBU3dMLENBQVQsRUFBVztBQUNWOztBQUVBQSxJQUFFLFlBQU0sQ0FFUCxDQUZEO0FBSUQsQ0FQRCxFQU9HZ0csTUFQSCIsImZpbGUiOiJkcmFmdC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU1ZHSW5qZWN0b3IgdjEuMS4zIC0gRmFzdCwgY2FjaGluZywgZHluYW1pYyBpbmxpbmUgU1ZHIERPTSBpbmplY3Rpb24gbGlicmFyeVxuICogaHR0cHM6Ly9naXRodWIuY29tL2ljb25pYy9TVkdJbmplY3RvclxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNC0yMDE1IFdheWJ1cnkgPGhlbGxvQHdheWJ1cnkuY29tPlxuICogQGxpY2Vuc2UgTUlUXG4gKi9cblxuKGZ1bmN0aW9uICh3aW5kb3csIGRvY3VtZW50KSB7XG5cbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIC8vIEVudmlyb25tZW50XG4gIHZhciBpc0xvY2FsID0gd2luZG93LmxvY2F0aW9uLnByb3RvY29sID09PSAnZmlsZTonO1xuICB2YXIgaGFzU3ZnU3VwcG9ydCA9IGRvY3VtZW50LmltcGxlbWVudGF0aW9uLmhhc0ZlYXR1cmUoJ2h0dHA6Ly93d3cudzMub3JnL1RSL1NWRzExL2ZlYXR1cmUjQmFzaWNTdHJ1Y3R1cmUnLCAnMS4xJyk7XG5cbiAgZnVuY3Rpb24gdW5pcXVlQ2xhc3NlcyhsaXN0KSB7XG4gICAgbGlzdCA9IGxpc3Quc3BsaXQoJyAnKTtcblxuICAgIHZhciBoYXNoID0ge307XG4gICAgdmFyIGkgPSBsaXN0Lmxlbmd0aDtcbiAgICB2YXIgb3V0ID0gW107XG5cbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICBpZiAoIWhhc2guaGFzT3duUHJvcGVydHkobGlzdFtpXSkpIHtcbiAgICAgICAgaGFzaFtsaXN0W2ldXSA9IDE7XG4gICAgICAgIG91dC51bnNoaWZ0KGxpc3RbaV0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvdXQuam9pbignICcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhY2hlIChvciBwb2x5ZmlsbCBmb3IgPD0gSUU4KSBBcnJheS5mb3JFYWNoKClcbiAgICogc291cmNlOiBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9BcnJheS9mb3JFYWNoXG4gICAqL1xuICB2YXIgZm9yRWFjaCA9IEFycmF5LnByb3RvdHlwZS5mb3JFYWNoIHx8IGZ1bmN0aW9uIChmbiwgc2NvcGUpIHtcbiAgICBpZiAodGhpcyA9PT0gdm9pZCAwIHx8IHRoaXMgPT09IG51bGwgfHwgdHlwZW9mIGZuICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCk7XG4gICAgfVxuXG4gICAgLyoganNoaW50IGJpdHdpc2U6IGZhbHNlICovXG4gICAgdmFyIGksIGxlbiA9IHRoaXMubGVuZ3RoID4+PiAwO1xuICAgIC8qIGpzaGludCBiaXR3aXNlOiB0cnVlICovXG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgIGlmIChpIGluIHRoaXMpIHtcbiAgICAgICAgZm4uY2FsbChzY29wZSwgdGhpc1tpXSwgaSwgdGhpcyk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIC8vIFNWRyBDYWNoZVxuICB2YXIgc3ZnQ2FjaGUgPSB7fTtcblxuICB2YXIgaW5qZWN0Q291bnQgPSAwO1xuICB2YXIgaW5qZWN0ZWRFbGVtZW50cyA9IFtdO1xuXG4gIC8vIFJlcXVlc3QgUXVldWVcbiAgdmFyIHJlcXVlc3RRdWV1ZSA9IFtdO1xuXG4gIC8vIFNjcmlwdCBydW5uaW5nIHN0YXR1c1xuICB2YXIgcmFuU2NyaXB0cyA9IHt9O1xuXG4gIHZhciBjbG9uZVN2ZyA9IGZ1bmN0aW9uIChzb3VyY2VTdmcpIHtcbiAgICByZXR1cm4gc291cmNlU3ZnLmNsb25lTm9kZSh0cnVlKTtcbiAgfTtcblxuICB2YXIgcXVldWVSZXF1ZXN0ID0gZnVuY3Rpb24gKHVybCwgY2FsbGJhY2spIHtcbiAgICByZXF1ZXN0UXVldWVbdXJsXSA9IHJlcXVlc3RRdWV1ZVt1cmxdIHx8IFtdO1xuICAgIHJlcXVlc3RRdWV1ZVt1cmxdLnB1c2goY2FsbGJhY2spO1xuICB9O1xuXG4gIHZhciBwcm9jZXNzUmVxdWVzdFF1ZXVlID0gZnVuY3Rpb24gKHVybCkge1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSByZXF1ZXN0UXVldWVbdXJsXS5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgLy8gTWFrZSB0aGVzZSBjYWxscyBhc3luYyBzbyB3ZSBhdm9pZCBibG9ja2luZyB0aGUgcGFnZS9yZW5kZXJlclxuICAgICAgLyoganNoaW50IGxvb3BmdW5jOiB0cnVlICovXG4gICAgICAoZnVuY3Rpb24gKGluZGV4KSB7XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHJlcXVlc3RRdWV1ZVt1cmxdW2luZGV4XShjbG9uZVN2ZyhzdmdDYWNoZVt1cmxdKSk7XG4gICAgICAgIH0sIDApO1xuICAgICAgfSkoaSk7XG4gICAgICAvKiBqc2hpbnQgbG9vcGZ1bmM6IGZhbHNlICovXG4gICAgfVxuICB9O1xuXG4gIHZhciBsb2FkU3ZnID0gZnVuY3Rpb24gKHVybCwgY2FsbGJhY2spIHtcbiAgICBpZiAoc3ZnQ2FjaGVbdXJsXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoc3ZnQ2FjaGVbdXJsXSBpbnN0YW5jZW9mIFNWR1NWR0VsZW1lbnQpIHtcbiAgICAgICAgLy8gV2UgYWxyZWFkeSBoYXZlIGl0IGluIGNhY2hlLCBzbyB1c2UgaXRcbiAgICAgICAgY2FsbGJhY2soY2xvbmVTdmcoc3ZnQ2FjaGVbdXJsXSkpO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIC8vIFdlIGRvbid0IGhhdmUgaXQgaW4gY2FjaGUgeWV0LCBidXQgd2UgYXJlIGxvYWRpbmcgaXQsIHNvIHF1ZXVlIHRoaXMgcmVxdWVzdFxuICAgICAgICBxdWV1ZVJlcXVlc3QodXJsLCBjYWxsYmFjayk7XG4gICAgICB9XG4gICAgfVxuICAgIGVsc2Uge1xuXG4gICAgICBpZiAoIXdpbmRvdy5YTUxIdHRwUmVxdWVzdCkge1xuICAgICAgICBjYWxsYmFjaygnQnJvd3NlciBkb2VzIG5vdCBzdXBwb3J0IFhNTEh0dHBSZXF1ZXN0Jyk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cblxuICAgICAgLy8gU2VlZCB0aGUgY2FjaGUgdG8gaW5kaWNhdGUgd2UgYXJlIGxvYWRpbmcgdGhpcyBVUkwgYWxyZWFkeVxuICAgICAgc3ZnQ2FjaGVbdXJsXSA9IHt9O1xuICAgICAgcXVldWVSZXF1ZXN0KHVybCwgY2FsbGJhY2spO1xuXG4gICAgICB2YXIgaHR0cFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcblxuICAgICAgaHR0cFJlcXVlc3Qub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyByZWFkeVN0YXRlIDQgPSBjb21wbGV0ZVxuICAgICAgICBpZiAoaHR0cFJlcXVlc3QucmVhZHlTdGF0ZSA9PT0gNCkge1xuXG4gICAgICAgICAgLy8gSGFuZGxlIHN0YXR1c1xuICAgICAgICAgIGlmIChodHRwUmVxdWVzdC5zdGF0dXMgPT09IDQwNCB8fCBodHRwUmVxdWVzdC5yZXNwb25zZVhNTCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgY2FsbGJhY2soJ1VuYWJsZSB0byBsb2FkIFNWRyBmaWxlOiAnICsgdXJsKTtcblxuICAgICAgICAgICAgaWYgKGlzTG9jYWwpIGNhbGxiYWNrKCdOb3RlOiBTVkcgaW5qZWN0aW9uIGFqYXggY2FsbHMgZG8gbm90IHdvcmsgbG9jYWxseSB3aXRob3V0IGFkanVzdGluZyBzZWN1cml0eSBzZXR0aW5nIGluIHlvdXIgYnJvd3Nlci4gT3IgY29uc2lkZXIgdXNpbmcgYSBsb2NhbCB3ZWJzZXJ2ZXIuJyk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gMjAwIHN1Y2Nlc3MgZnJvbSBzZXJ2ZXIsIG9yIDAgd2hlbiB1c2luZyBmaWxlOi8vIHByb3RvY29sIGxvY2FsbHlcbiAgICAgICAgICBpZiAoaHR0cFJlcXVlc3Quc3RhdHVzID09PSAyMDAgfHwgKGlzTG9jYWwgJiYgaHR0cFJlcXVlc3Quc3RhdHVzID09PSAwKSkge1xuXG4gICAgICAgICAgICAvKiBnbG9iYWxzIERvY3VtZW50ICovXG4gICAgICAgICAgICBpZiAoaHR0cFJlcXVlc3QucmVzcG9uc2VYTUwgaW5zdGFuY2VvZiBEb2N1bWVudCkge1xuICAgICAgICAgICAgICAvLyBDYWNoZSBpdFxuICAgICAgICAgICAgICBzdmdDYWNoZVt1cmxdID0gaHR0cFJlcXVlc3QucmVzcG9uc2VYTUwuZG9jdW1lbnRFbGVtZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLyogZ2xvYmFscyAtRG9jdW1lbnQgKi9cblxuICAgICAgICAgICAgLy8gSUU5IGRvZXNuJ3QgY3JlYXRlIGEgcmVzcG9uc2VYTUwgRG9jdW1lbnQgb2JqZWN0IGZyb20gbG9hZGVkIFNWRyxcbiAgICAgICAgICAgIC8vIGFuZCB0aHJvd3MgYSBcIkRPTSBFeGNlcHRpb246IEhJRVJBUkNIWV9SRVFVRVNUX0VSUiAoMylcIiBlcnJvciB3aGVuIGluamVjdGVkLlxuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIFNvLCB3ZSdsbCBqdXN0IGNyZWF0ZSBvdXIgb3duIG1hbnVhbGx5IHZpYSB0aGUgRE9NUGFyc2VyIHVzaW5nXG4gICAgICAgICAgICAvLyB0aGUgdGhlIHJhdyBYTUwgcmVzcG9uc2VUZXh0LlxuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIDpOT1RFOiBJRTggYW5kIG9sZGVyIGRvZXNuJ3QgaGF2ZSBET01QYXJzZXIsIGJ1dCB0aGV5IGNhbid0IGRvIFNWRyBlaXRoZXIsIHNvLi4uXG4gICAgICAgICAgICBlbHNlIGlmIChET01QYXJzZXIgJiYgKERPTVBhcnNlciBpbnN0YW5jZW9mIEZ1bmN0aW9uKSkge1xuICAgICAgICAgICAgICB2YXIgeG1sRG9jO1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHZhciBwYXJzZXIgPSBuZXcgRE9NUGFyc2VyKCk7XG4gICAgICAgICAgICAgICAgeG1sRG9jID0gcGFyc2VyLnBhcnNlRnJvbVN0cmluZyhodHRwUmVxdWVzdC5yZXNwb25zZVRleHQsICd0ZXh0L3htbCcpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgeG1sRG9jID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgaWYgKCF4bWxEb2MgfHwgeG1sRG9jLmdldEVsZW1lbnRzQnlUYWdOYW1lKCdwYXJzZXJlcnJvcicpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKCdVbmFibGUgdG8gcGFyc2UgU1ZHIGZpbGU6ICcgKyB1cmwpO1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBDYWNoZSBpdFxuICAgICAgICAgICAgICAgIHN2Z0NhY2hlW3VybF0gPSB4bWxEb2MuZG9jdW1lbnRFbGVtZW50O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFdlJ3ZlIGxvYWRlZCBhIG5ldyBhc3NldCwgc28gcHJvY2VzcyBhbnkgcmVxdWVzdHMgd2FpdGluZyBmb3IgaXRcbiAgICAgICAgICAgIHByb2Nlc3NSZXF1ZXN0UXVldWUodXJsKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBjYWxsYmFjaygnVGhlcmUgd2FzIGEgcHJvYmxlbSBpbmplY3RpbmcgdGhlIFNWRzogJyArIGh0dHBSZXF1ZXN0LnN0YXR1cyArICcgJyArIGh0dHBSZXF1ZXN0LnN0YXR1c1RleHQpO1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgaHR0cFJlcXVlc3Qub3BlbignR0VUJywgdXJsKTtcblxuICAgICAgLy8gVHJlYXQgYW5kIHBhcnNlIHRoZSByZXNwb25zZSBhcyBYTUwsIGV2ZW4gaWYgdGhlXG4gICAgICAvLyBzZXJ2ZXIgc2VuZHMgdXMgYSBkaWZmZXJlbnQgbWltZXR5cGVcbiAgICAgIGlmIChodHRwUmVxdWVzdC5vdmVycmlkZU1pbWVUeXBlKSBodHRwUmVxdWVzdC5vdmVycmlkZU1pbWVUeXBlKCd0ZXh0L3htbCcpO1xuXG4gICAgICBodHRwUmVxdWVzdC5zZW5kKCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIEluamVjdCBhIHNpbmdsZSBlbGVtZW50XG4gIHZhciBpbmplY3RFbGVtZW50ID0gZnVuY3Rpb24gKGVsLCBldmFsU2NyaXB0cywgcG5nRmFsbGJhY2ssIGNhbGxiYWNrKSB7XG5cbiAgICAvLyBHcmFiIHRoZSBzcmMgb3IgZGF0YS1zcmMgYXR0cmlidXRlXG4gICAgdmFyIGltZ1VybCA9IGVsLmdldEF0dHJpYnV0ZSgnZGF0YS1zcmMnKSB8fCBlbC5nZXRBdHRyaWJ1dGUoJ3NyYycpO1xuXG4gICAgLy8gV2UgY2FuIG9ubHkgaW5qZWN0IFNWR1xuICAgIGlmICghKC9cXC5zdmcvaSkudGVzdChpbWdVcmwpKSB7XG4gICAgICBjYWxsYmFjaygnQXR0ZW1wdGVkIHRvIGluamVjdCBhIGZpbGUgd2l0aCBhIG5vbi1zdmcgZXh0ZW5zaW9uOiAnICsgaW1nVXJsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBJZiB3ZSBkb24ndCBoYXZlIFNWRyBzdXBwb3J0IHRyeSB0byBmYWxsIGJhY2sgdG8gYSBwbmcsXG4gICAgLy8gZWl0aGVyIGRlZmluZWQgcGVyLWVsZW1lbnQgdmlhIGRhdGEtZmFsbGJhY2sgb3IgZGF0YS1wbmcsXG4gICAgLy8gb3IgZ2xvYmFsbHkgdmlhIHRoZSBwbmdGYWxsYmFjayBkaXJlY3Rvcnkgc2V0dGluZ1xuICAgIGlmICghaGFzU3ZnU3VwcG9ydCkge1xuICAgICAgdmFyIHBlckVsZW1lbnRGYWxsYmFjayA9IGVsLmdldEF0dHJpYnV0ZSgnZGF0YS1mYWxsYmFjaycpIHx8IGVsLmdldEF0dHJpYnV0ZSgnZGF0YS1wbmcnKTtcblxuICAgICAgLy8gUGVyLWVsZW1lbnQgc3BlY2lmaWMgUE5HIGZhbGxiYWNrIGRlZmluZWQsIHNvIHVzZSB0aGF0XG4gICAgICBpZiAocGVyRWxlbWVudEZhbGxiYWNrKSB7XG4gICAgICAgIGVsLnNldEF0dHJpYnV0ZSgnc3JjJywgcGVyRWxlbWVudEZhbGxiYWNrKTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICB9XG4gICAgICAvLyBHbG9iYWwgUE5HIGZhbGxiYWNrIGRpcmVjdG9yaXkgZGVmaW5lZCwgdXNlIHRoZSBzYW1lLW5hbWVkIFBOR1xuICAgICAgZWxzZSBpZiAocG5nRmFsbGJhY2spIHtcbiAgICAgICAgZWwuc2V0QXR0cmlidXRlKCdzcmMnLCBwbmdGYWxsYmFjayArICcvJyArIGltZ1VybC5zcGxpdCgnLycpLnBvcCgpLnJlcGxhY2UoJy5zdmcnLCAnLnBuZycpKTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICB9XG4gICAgICAvLyB1bS4uLlxuICAgICAgZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKCdUaGlzIGJyb3dzZXIgZG9lcyBub3Qgc3VwcG9ydCBTVkcgYW5kIG5vIFBORyBmYWxsYmFjayB3YXMgZGVmaW5lZC4nKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE1ha2Ugc3VyZSB3ZSBhcmVuJ3QgYWxyZWFkeSBpbiB0aGUgcHJvY2VzcyBvZiBpbmplY3RpbmcgdGhpcyBlbGVtZW50IHRvXG4gICAgLy8gYXZvaWQgYSByYWNlIGNvbmRpdGlvbiBpZiBtdWx0aXBsZSBpbmplY3Rpb25zIGZvciB0aGUgc2FtZSBlbGVtZW50IGFyZSBydW4uXG4gICAgLy8gOk5PVEU6IFVzaW5nIGluZGV4T2YoKSBvbmx5IF9hZnRlcl8gd2UgY2hlY2sgZm9yIFNWRyBzdXBwb3J0IGFuZCBiYWlsLFxuICAgIC8vIHNvIG5vIG5lZWQgZm9yIElFOCBpbmRleE9mKCkgcG9seWZpbGxcbiAgICBpZiAoaW5qZWN0ZWRFbGVtZW50cy5pbmRleE9mKGVsKSAhPT0gLTEpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBSZW1lbWJlciB0aGUgcmVxdWVzdCB0byBpbmplY3QgdGhpcyBlbGVtZW50LCBpbiBjYXNlIG90aGVyIGluamVjdGlvblxuICAgIC8vIGNhbGxzIGFyZSBhbHNvIHRyeWluZyB0byByZXBsYWNlIHRoaXMgZWxlbWVudCBiZWZvcmUgd2UgZmluaXNoXG4gICAgaW5qZWN0ZWRFbGVtZW50cy5wdXNoKGVsKTtcblxuICAgIC8vIFRyeSB0byBhdm9pZCBsb2FkaW5nIHRoZSBvcmdpbmFsIGltYWdlIHNyYyBpZiBwb3NzaWJsZS5cbiAgICBlbC5zZXRBdHRyaWJ1dGUoJ3NyYycsICcnKTtcblxuICAgIC8vIExvYWQgaXQgdXBcbiAgICBsb2FkU3ZnKGltZ1VybCwgZnVuY3Rpb24gKHN2Zykge1xuXG4gICAgICBpZiAodHlwZW9mIHN2ZyA9PT0gJ3VuZGVmaW5lZCcgfHwgdHlwZW9mIHN2ZyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgY2FsbGJhY2soc3ZnKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICB2YXIgaW1nSWQgPSBlbC5nZXRBdHRyaWJ1dGUoJ2lkJyk7XG4gICAgICBpZiAoaW1nSWQpIHtcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZSgnaWQnLCBpbWdJZCk7XG4gICAgICB9XG5cbiAgICAgIHZhciBpbWdUaXRsZSA9IGVsLmdldEF0dHJpYnV0ZSgndGl0bGUnKTtcbiAgICAgIGlmIChpbWdUaXRsZSkge1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKCd0aXRsZScsIGltZ1RpdGxlKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29uY2F0IHRoZSBTVkcgY2xhc3NlcyArICdpbmplY3RlZC1zdmcnICsgdGhlIGltZyBjbGFzc2VzXG4gICAgICB2YXIgY2xhc3NNZXJnZSA9IFtdLmNvbmNhdChzdmcuZ2V0QXR0cmlidXRlKCdjbGFzcycpIHx8IFtdLCAnaW5qZWN0ZWQtc3ZnJywgZWwuZ2V0QXR0cmlidXRlKCdjbGFzcycpIHx8IFtdKS5qb2luKCcgJyk7XG4gICAgICBzdmcuc2V0QXR0cmlidXRlKCdjbGFzcycsIHVuaXF1ZUNsYXNzZXMoY2xhc3NNZXJnZSkpO1xuXG4gICAgICB2YXIgaW1nU3R5bGUgPSBlbC5nZXRBdHRyaWJ1dGUoJ3N0eWxlJyk7XG4gICAgICBpZiAoaW1nU3R5bGUpIHtcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZSgnc3R5bGUnLCBpbWdTdHlsZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIENvcHkgYWxsIHRoZSBkYXRhIGVsZW1lbnRzIHRvIHRoZSBzdmdcbiAgICAgIHZhciBpbWdEYXRhID0gW10uZmlsdGVyLmNhbGwoZWwuYXR0cmlidXRlcywgZnVuY3Rpb24gKGF0KSB7XG4gICAgICAgIHJldHVybiAoL15kYXRhLVxcd1tcXHdcXC1dKiQvKS50ZXN0KGF0Lm5hbWUpO1xuICAgICAgfSk7XG4gICAgICBmb3JFYWNoLmNhbGwoaW1nRGF0YSwgZnVuY3Rpb24gKGRhdGFBdHRyKSB7XG4gICAgICAgIGlmIChkYXRhQXR0ci5uYW1lICYmIGRhdGFBdHRyLnZhbHVlKSB7XG4gICAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShkYXRhQXR0ci5uYW1lLCBkYXRhQXR0ci52YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBNYWtlIHN1cmUgYW55IGludGVybmFsbHkgcmVmZXJlbmNlZCBjbGlwUGF0aCBpZHMgYW5kIHRoZWlyXG4gICAgICAvLyBjbGlwLXBhdGggcmVmZXJlbmNlcyBhcmUgdW5pcXVlLlxuICAgICAgLy9cbiAgICAgIC8vIFRoaXMgYWRkcmVzc2VzIHRoZSBpc3N1ZSBvZiBoYXZpbmcgbXVsdGlwbGUgaW5zdGFuY2VzIG9mIHRoZVxuICAgICAgLy8gc2FtZSBTVkcgb24gYSBwYWdlIGFuZCBvbmx5IHRoZSBmaXJzdCBjbGlwUGF0aCBpZCBpcyByZWZlcmVuY2VkLlxuICAgICAgLy9cbiAgICAgIC8vIEJyb3dzZXJzIG9mdGVuIHNob3J0Y3V0IHRoZSBTVkcgU3BlYyBhbmQgZG9uJ3QgdXNlIGNsaXBQYXRoc1xuICAgICAgLy8gY29udGFpbmVkIGluIHBhcmVudCBlbGVtZW50cyB0aGF0IGFyZSBoaWRkZW4sIHNvIGlmIHlvdSBoaWRlIHRoZSBmaXJzdFxuICAgICAgLy8gU1ZHIGluc3RhbmNlIG9uIHRoZSBwYWdlLCB0aGVuIGFsbCBvdGhlciBpbnN0YW5jZXMgbG9zZSB0aGVpciBjbGlwcGluZy5cbiAgICAgIC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Mzc2MDI3XG5cbiAgICAgIC8vIEhhbmRsZSBhbGwgZGVmcyBlbGVtZW50cyB0aGF0IGhhdmUgaXJpIGNhcGFibGUgYXR0cmlidXRlcyBhcyBkZWZpbmVkIGJ5IHczYzogaHR0cDovL3d3dy53My5vcmcvVFIvU1ZHL2xpbmtpbmcuaHRtbCNwcm9jZXNzaW5nSVJJXG4gICAgICAvLyBNYXBwaW5nIElSSSBhZGRyZXNzYWJsZSBlbGVtZW50cyB0byB0aGUgcHJvcGVydGllcyB0aGF0IGNhbiByZWZlcmVuY2UgdGhlbTpcbiAgICAgIHZhciBpcmlFbGVtZW50c0FuZFByb3BlcnRpZXMgPSB7XG4gICAgICAgICdjbGlwUGF0aCc6IFsnY2xpcC1wYXRoJ10sXG4gICAgICAgICdjb2xvci1wcm9maWxlJzogWydjb2xvci1wcm9maWxlJ10sXG4gICAgICAgICdjdXJzb3InOiBbJ2N1cnNvciddLFxuICAgICAgICAnZmlsdGVyJzogWydmaWx0ZXInXSxcbiAgICAgICAgJ2xpbmVhckdyYWRpZW50JzogWydmaWxsJywgJ3N0cm9rZSddLFxuICAgICAgICAnbWFya2VyJzogWydtYXJrZXInLCAnbWFya2VyLXN0YXJ0JywgJ21hcmtlci1taWQnLCAnbWFya2VyLWVuZCddLFxuICAgICAgICAnbWFzayc6IFsnbWFzayddLFxuICAgICAgICAncGF0dGVybic6IFsnZmlsbCcsICdzdHJva2UnXSxcbiAgICAgICAgJ3JhZGlhbEdyYWRpZW50JzogWydmaWxsJywgJ3N0cm9rZSddXG4gICAgICB9O1xuXG4gICAgICB2YXIgZWxlbWVudCwgZWxlbWVudERlZnMsIHByb3BlcnRpZXMsIGN1cnJlbnRJZCwgbmV3SWQ7XG4gICAgICBPYmplY3Qua2V5cyhpcmlFbGVtZW50c0FuZFByb3BlcnRpZXMpLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgICBlbGVtZW50ID0ga2V5O1xuICAgICAgICBwcm9wZXJ0aWVzID0gaXJpRWxlbWVudHNBbmRQcm9wZXJ0aWVzW2tleV07XG5cbiAgICAgICAgZWxlbWVudERlZnMgPSBzdmcucXVlcnlTZWxlY3RvckFsbCgnZGVmcyAnICsgZWxlbWVudCArICdbaWRdJyk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBlbGVtZW50c0xlbiA9IGVsZW1lbnREZWZzLmxlbmd0aDsgaSA8IGVsZW1lbnRzTGVuOyBpKyspIHtcbiAgICAgICAgICBjdXJyZW50SWQgPSBlbGVtZW50RGVmc1tpXS5pZDtcbiAgICAgICAgICBuZXdJZCA9IGN1cnJlbnRJZCArICctJyArIGluamVjdENvdW50O1xuXG4gICAgICAgICAgLy8gQWxsIG9mIHRoZSBwcm9wZXJ0aWVzIHRoYXQgY2FuIHJlZmVyZW5jZSB0aGlzIGVsZW1lbnQgdHlwZVxuICAgICAgICAgIHZhciByZWZlcmVuY2luZ0VsZW1lbnRzO1xuICAgICAgICAgIGZvckVhY2guY2FsbChwcm9wZXJ0aWVzLCBmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIC8vIDpOT1RFOiB1c2luZyBhIHN1YnN0cmluZyBtYXRjaCBhdHRyIHNlbGVjdG9yIGhlcmUgdG8gZGVhbCB3aXRoIElFIFwiYWRkaW5nIGV4dHJhIHF1b3RlcyBpbiB1cmwoKSBhdHRyc1wiXG4gICAgICAgICAgICByZWZlcmVuY2luZ0VsZW1lbnRzID0gc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJ1snICsgcHJvcGVydHkgKyAnKj1cIicgKyBjdXJyZW50SWQgKyAnXCJdJyk7XG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMCwgcmVmZXJlbmNpbmdFbGVtZW50TGVuID0gcmVmZXJlbmNpbmdFbGVtZW50cy5sZW5ndGg7IGogPCByZWZlcmVuY2luZ0VsZW1lbnRMZW47IGorKykge1xuICAgICAgICAgICAgICByZWZlcmVuY2luZ0VsZW1lbnRzW2pdLnNldEF0dHJpYnV0ZShwcm9wZXJ0eSwgJ3VybCgjJyArIG5ld0lkICsgJyknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIGVsZW1lbnREZWZzW2ldLmlkID0gbmV3SWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZW1vdmUgYW55IHVud2FudGVkL2ludmFsaWQgbmFtZXNwYWNlcyB0aGF0IG1pZ2h0IGhhdmUgYmVlbiBhZGRlZCBieSBTVkcgZWRpdGluZyB0b29sc1xuICAgICAgc3ZnLnJlbW92ZUF0dHJpYnV0ZSgneG1sbnM6YScpO1xuXG4gICAgICAvLyBQb3N0IHBhZ2UgbG9hZCBpbmplY3RlZCBTVkdzIGRvbid0IGF1dG9tYXRpY2FsbHkgaGF2ZSB0aGVpciBzY3JpcHRcbiAgICAgIC8vIGVsZW1lbnRzIHJ1biwgc28gd2UnbGwgbmVlZCB0byBtYWtlIHRoYXQgaGFwcGVuLCBpZiByZXF1ZXN0ZWRcblxuICAgICAgLy8gRmluZCB0aGVuIHBydW5lIHRoZSBzY3JpcHRzXG4gICAgICB2YXIgc2NyaXB0cyA9IHN2Zy5xdWVyeVNlbGVjdG9yQWxsKCdzY3JpcHQnKTtcbiAgICAgIHZhciBzY3JpcHRzVG9FdmFsID0gW107XG4gICAgICB2YXIgc2NyaXB0LCBzY3JpcHRUeXBlO1xuXG4gICAgICBmb3IgKHZhciBrID0gMCwgc2NyaXB0c0xlbiA9IHNjcmlwdHMubGVuZ3RoOyBrIDwgc2NyaXB0c0xlbjsgaysrKSB7XG4gICAgICAgIHNjcmlwdFR5cGUgPSBzY3JpcHRzW2tdLmdldEF0dHJpYnV0ZSgndHlwZScpO1xuXG4gICAgICAgIC8vIE9ubHkgcHJvY2VzcyBqYXZhc2NyaXB0IHR5cGVzLlxuICAgICAgICAvLyBTVkcgZGVmYXVsdHMgdG8gJ2FwcGxpY2F0aW9uL2VjbWFzY3JpcHQnIGZvciB1bnNldCB0eXBlc1xuICAgICAgICBpZiAoIXNjcmlwdFR5cGUgfHwgc2NyaXB0VHlwZSA9PT0gJ2FwcGxpY2F0aW9uL2VjbWFzY3JpcHQnIHx8IHNjcmlwdFR5cGUgPT09ICdhcHBsaWNhdGlvbi9qYXZhc2NyaXB0Jykge1xuXG4gICAgICAgICAgLy8gaW5uZXJUZXh0IGZvciBJRSwgdGV4dENvbnRlbnQgZm9yIG90aGVyIGJyb3dzZXJzXG4gICAgICAgICAgc2NyaXB0ID0gc2NyaXB0c1trXS5pbm5lclRleHQgfHwgc2NyaXB0c1trXS50ZXh0Q29udGVudDtcblxuICAgICAgICAgIC8vIFN0YXNoXG4gICAgICAgICAgc2NyaXB0c1RvRXZhbC5wdXNoKHNjcmlwdCk7XG5cbiAgICAgICAgICAvLyBUaWR5IHVwIGFuZCByZW1vdmUgdGhlIHNjcmlwdCBlbGVtZW50IHNpbmNlIHdlIGRvbid0IG5lZWQgaXQgYW55bW9yZVxuICAgICAgICAgIHN2Zy5yZW1vdmVDaGlsZChzY3JpcHRzW2tdKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBSdW4vRXZhbCB0aGUgc2NyaXB0cyBpZiBuZWVkZWRcbiAgICAgIGlmIChzY3JpcHRzVG9FdmFsLmxlbmd0aCA+IDAgJiYgKGV2YWxTY3JpcHRzID09PSAnYWx3YXlzJyB8fCAoZXZhbFNjcmlwdHMgPT09ICdvbmNlJyAmJiAhcmFuU2NyaXB0c1tpbWdVcmxdKSkpIHtcbiAgICAgICAgZm9yICh2YXIgbCA9IDAsIHNjcmlwdHNUb0V2YWxMZW4gPSBzY3JpcHRzVG9FdmFsLmxlbmd0aDsgbCA8IHNjcmlwdHNUb0V2YWxMZW47IGwrKykge1xuXG4gICAgICAgICAgLy8gOk5PVEU6IFl1cCwgdGhpcyBpcyBhIGZvcm0gb2YgZXZhbCwgYnV0IGl0IGlzIGJlaW5nIHVzZWQgdG8gZXZhbCBjb2RlXG4gICAgICAgICAgLy8gdGhlIGNhbGxlciBoYXMgZXhwbGljdGVseSBhc2tlZCB0byBiZSBsb2FkZWQsIGFuZCB0aGUgY29kZSBpcyBpbiBhIGNhbGxlclxuICAgICAgICAgIC8vIGRlZmluZWQgU1ZHIGZpbGUuLi4gbm90IHJhdyB1c2VyIGlucHV0LlxuICAgICAgICAgIC8vXG4gICAgICAgICAgLy8gQWxzbywgdGhlIGNvZGUgaXMgZXZhbHVhdGVkIGluIGEgY2xvc3VyZSBhbmQgbm90IGluIHRoZSBnbG9iYWwgc2NvcGUuXG4gICAgICAgICAgLy8gSWYgeW91IG5lZWQgdG8gcHV0IHNvbWV0aGluZyBpbiBnbG9iYWwgc2NvcGUsIHVzZSAnd2luZG93J1xuICAgICAgICAgIG5ldyBGdW5jdGlvbihzY3JpcHRzVG9FdmFsW2xdKSh3aW5kb3cpOyAvLyBqc2hpbnQgaWdub3JlOmxpbmVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlbWVtYmVyIHdlIGFscmVhZHkgcmFuIHNjcmlwdHMgZm9yIHRoaXMgc3ZnXG4gICAgICAgIHJhblNjcmlwdHNbaW1nVXJsXSA9IHRydWU7XG4gICAgICB9XG5cbiAgICAgIC8vIDpXT1JLQVJPVU5EOlxuICAgICAgLy8gSUUgZG9lc24ndCBldmFsdWF0ZSA8c3R5bGU+IHRhZ3MgaW4gU1ZHcyB0aGF0IGFyZSBkeW5hbWljYWxseSBhZGRlZCB0byB0aGUgcGFnZS5cbiAgICAgIC8vIFRoaXMgdHJpY2sgd2lsbCB0cmlnZ2VyIElFIHRvIHJlYWQgYW5kIHVzZSBhbnkgZXhpc3RpbmcgU1ZHIDxzdHlsZT4gdGFncy5cbiAgICAgIC8vXG4gICAgICAvLyBSZWZlcmVuY2U6IGh0dHBzOi8vZ2l0aHViLmNvbS9pY29uaWMvU1ZHSW5qZWN0b3IvaXNzdWVzLzIzXG4gICAgICB2YXIgc3R5bGVUYWdzID0gc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJ3N0eWxlJyk7XG4gICAgICBmb3JFYWNoLmNhbGwoc3R5bGVUYWdzLCBmdW5jdGlvbiAoc3R5bGVUYWcpIHtcbiAgICAgICAgc3R5bGVUYWcudGV4dENvbnRlbnQgKz0gJyc7XG4gICAgICB9KTtcblxuICAgICAgLy8gUmVwbGFjZSB0aGUgaW1hZ2Ugd2l0aCB0aGUgc3ZnXG4gICAgICBlbC5wYXJlbnROb2RlLnJlcGxhY2VDaGlsZChzdmcsIGVsKTtcblxuICAgICAgLy8gTm93IHRoYXQgd2Ugbm8gbG9uZ2VyIG5lZWQgaXQsIGRyb3AgcmVmZXJlbmNlc1xuICAgICAgLy8gdG8gdGhlIG9yaWdpbmFsIGVsZW1lbnQgc28gaXQgY2FuIGJlIEdDJ2RcbiAgICAgIGRlbGV0ZSBpbmplY3RlZEVsZW1lbnRzW2luamVjdGVkRWxlbWVudHMuaW5kZXhPZihlbCldO1xuICAgICAgZWwgPSBudWxsO1xuXG4gICAgICAvLyBJbmNyZW1lbnQgdGhlIGluamVjdGVkIGNvdW50XG4gICAgICBpbmplY3RDb3VudCsrO1xuXG4gICAgICBjYWxsYmFjayhzdmcpO1xuICAgIH0pO1xuICB9O1xuXG4gIC8qKlxuICAgKiBTVkdJbmplY3RvclxuICAgKlxuICAgKiBSZXBsYWNlIHRoZSBnaXZlbiBlbGVtZW50cyB3aXRoIHRoZWlyIGZ1bGwgaW5saW5lIFNWRyBET00gZWxlbWVudHMuXG4gICAqXG4gICAqIDpOT1RFOiBXZSBhcmUgdXNpbmcgZ2V0L3NldEF0dHJpYnV0ZSB3aXRoIFNWRyBiZWNhdXNlIHRoZSBTVkcgRE9NIHNwZWMgZGlmZmVycyBmcm9tIEhUTUwgRE9NIGFuZFxuICAgKiBjYW4gcmV0dXJuIG90aGVyIHVuZXhwZWN0ZWQgb2JqZWN0IHR5cGVzIHdoZW4gdHJ5aW5nIHRvIGRpcmVjdGx5IGFjY2VzcyBzdmcgcHJvcGVydGllcy5cbiAgICogZXg6IFwiY2xhc3NOYW1lXCIgcmV0dXJucyBhIFNWR0FuaW1hdGVkU3RyaW5nIHdpdGggdGhlIGNsYXNzIHZhbHVlIGZvdW5kIGluIHRoZSBcImJhc2VWYWxcIiBwcm9wZXJ0eSxcbiAgICogaW5zdGVhZCBvZiBzaW1wbGUgc3RyaW5nIGxpa2Ugd2l0aCBIVE1MIEVsZW1lbnRzLlxuICAgKlxuICAgKiBAcGFyYW0ge21peGVzfSBBcnJheSBvZiBvciBzaW5nbGUgRE9NIGVsZW1lbnRcbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnNcbiAgICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2tcbiAgICogQHJldHVybiB7b2JqZWN0fSBJbnN0YW5jZSBvZiBTVkdJbmplY3RvclxuICAgKi9cbiAgdmFyIFNWR0luamVjdG9yID0gZnVuY3Rpb24gKGVsZW1lbnRzLCBvcHRpb25zLCBkb25lKSB7XG5cbiAgICAvLyBPcHRpb25zICYgZGVmYXVsdHNcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgIC8vIFNob3VsZCB3ZSBydW4gdGhlIHNjcmlwdHMgYmxvY2tzIGZvdW5kIGluIHRoZSBTVkdcbiAgICAvLyAnYWx3YXlzJyAtIFJ1biB0aGVtIGV2ZXJ5IHRpbWVcbiAgICAvLyAnb25jZScgLSBPbmx5IHJ1biBzY3JpcHRzIG9uY2UgZm9yIGVhY2ggU1ZHXG4gICAgLy8gW2ZhbHNlfCduZXZlciddIC0gSWdub3JlIHNjcmlwdHNcbiAgICB2YXIgZXZhbFNjcmlwdHMgPSBvcHRpb25zLmV2YWxTY3JpcHRzIHx8ICdhbHdheXMnO1xuXG4gICAgLy8gTG9jYXRpb24gb2YgZmFsbGJhY2sgcG5ncywgaWYgZGVzaXJlZFxuICAgIHZhciBwbmdGYWxsYmFjayA9IG9wdGlvbnMucG5nRmFsbGJhY2sgfHwgZmFsc2U7XG5cbiAgICAvLyBDYWxsYmFjayB0byBydW4gZHVyaW5nIGVhY2ggU1ZHIGluamVjdGlvbiwgcmV0dXJuaW5nIHRoZSBTVkcgaW5qZWN0ZWRcbiAgICB2YXIgZWFjaENhbGxiYWNrID0gb3B0aW9ucy5lYWNoO1xuXG4gICAgLy8gRG8gdGhlIGluamVjdGlvbi4uLlxuICAgIGlmIChlbGVtZW50cy5sZW5ndGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgdmFyIGVsZW1lbnRzTG9hZGVkID0gMDtcbiAgICAgIGZvckVhY2guY2FsbChlbGVtZW50cywgZnVuY3Rpb24gKGVsZW1lbnQpIHtcbiAgICAgICAgaW5qZWN0RWxlbWVudChlbGVtZW50LCBldmFsU2NyaXB0cywgcG5nRmFsbGJhY2ssIGZ1bmN0aW9uIChzdmcpIHtcbiAgICAgICAgICBpZiAoZWFjaENhbGxiYWNrICYmIHR5cGVvZiBlYWNoQ2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIGVhY2hDYWxsYmFjayhzdmcpO1xuICAgICAgICAgIGlmIChkb25lICYmIGVsZW1lbnRzLmxlbmd0aCA9PT0gKytlbGVtZW50c0xvYWRlZCkgZG9uZShlbGVtZW50c0xvYWRlZCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgaWYgKGVsZW1lbnRzKSB7XG4gICAgICAgIGluamVjdEVsZW1lbnQoZWxlbWVudHMsIGV2YWxTY3JpcHRzLCBwbmdGYWxsYmFjaywgZnVuY3Rpb24gKHN2Zykge1xuICAgICAgICAgIGlmIChlYWNoQ2FsbGJhY2sgJiYgdHlwZW9mIGVhY2hDYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgZWFjaENhbGxiYWNrKHN2Zyk7XG4gICAgICAgICAgaWYgKGRvbmUpIGRvbmUoMSk7XG4gICAgICAgICAgZWxlbWVudHMgPSBudWxsO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGVsc2Uge1xuICAgICAgICBpZiAoZG9uZSkgZG9uZSgwKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLyogZ2xvYmFsIG1vZHVsZSwgZXhwb3J0czogdHJ1ZSwgZGVmaW5lICovXG4gIC8vIE5vZGUuanMgb3IgQ29tbW9uSlNcbiAgaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2R1bGUuZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSBTVkdJbmplY3RvcjtcbiAgfVxuICAvLyBBTUQgc3VwcG9ydFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgICBkZWZpbmUoZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIFNWR0luamVjdG9yO1xuICAgIH0pO1xuICB9XG4gIC8vIE90aGVyd2lzZSwgYXR0YWNoIHRvIHdpbmRvdyBhcyBnbG9iYWxcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpIHtcbiAgICB3aW5kb3cuU1ZHSW5qZWN0b3IgPSBTVkdJbmplY3RvcjtcbiAgfVxuICAvKiBnbG9iYWwgLW1vZHVsZSwgLWV4cG9ydHMsIC1kZWZpbmUgKi9cblxufSh3aW5kb3csIGRvY3VtZW50KSk7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0ICQgZnJvbSAnanF1ZXJ5JztcbmltcG9ydCB7IEdldFlvRGlnaXRzIH0gZnJvbSAnLi9mb3VuZGF0aW9uLnV0aWwuY29yZSc7XG5pbXBvcnQgeyBNZWRpYVF1ZXJ5IH0gZnJvbSAnLi9mb3VuZGF0aW9uLnV0aWwubWVkaWFRdWVyeSc7XG5cbnZhciBGT1VOREFUSU9OX1ZFUlNJT04gPSAnNi40LjEnO1xuXG4vLyBHbG9iYWwgRm91bmRhdGlvbiBvYmplY3Rcbi8vIFRoaXMgaXMgYXR0YWNoZWQgdG8gdGhlIHdpbmRvdywgb3IgdXNlZCBhcyBhIG1vZHVsZSBmb3IgQU1EL0Jyb3dzZXJpZnlcbnZhciBGb3VuZGF0aW9uID0ge1xuICB2ZXJzaW9uOiBGT1VOREFUSU9OX1ZFUlNJT04sXG5cbiAgLyoqXG4gICAqIFN0b3JlcyBpbml0aWFsaXplZCBwbHVnaW5zLlxuICAgKi9cbiAgX3BsdWdpbnM6IHt9LFxuXG4gIC8qKlxuICAgKiBTdG9yZXMgZ2VuZXJhdGVkIHVuaXF1ZSBpZHMgZm9yIHBsdWdpbiBpbnN0YW5jZXNcbiAgICovXG4gIF91dWlkczogW10sXG5cbiAgLyoqXG4gICAqIERlZmluZXMgYSBGb3VuZGF0aW9uIHBsdWdpbiwgYWRkaW5nIGl0IHRvIHRoZSBgRm91bmRhdGlvbmAgbmFtZXNwYWNlIGFuZCB0aGUgbGlzdCBvZiBwbHVnaW5zIHRvIGluaXRpYWxpemUgd2hlbiByZWZsb3dpbmcuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwbHVnaW4gLSBUaGUgY29uc3RydWN0b3Igb2YgdGhlIHBsdWdpbi5cbiAgICovXG4gIHBsdWdpbjogZnVuY3Rpb24ocGx1Z2luLCBuYW1lKSB7XG4gICAgLy8gT2JqZWN0IGtleSB0byB1c2Ugd2hlbiBhZGRpbmcgdG8gZ2xvYmFsIEZvdW5kYXRpb24gb2JqZWN0XG4gICAgLy8gRXhhbXBsZXM6IEZvdW5kYXRpb24uUmV2ZWFsLCBGb3VuZGF0aW9uLk9mZkNhbnZhc1xuICAgIHZhciBjbGFzc05hbWUgPSAobmFtZSB8fCBmdW5jdGlvbk5hbWUocGx1Z2luKSk7XG4gICAgLy8gT2JqZWN0IGtleSB0byB1c2Ugd2hlbiBzdG9yaW5nIHRoZSBwbHVnaW4sIGFsc28gdXNlZCB0byBjcmVhdGUgdGhlIGlkZW50aWZ5aW5nIGRhdGEgYXR0cmlidXRlIGZvciB0aGUgcGx1Z2luXG4gICAgLy8gRXhhbXBsZXM6IGRhdGEtcmV2ZWFsLCBkYXRhLW9mZi1jYW52YXNcbiAgICB2YXIgYXR0ck5hbWUgID0gaHlwaGVuYXRlKGNsYXNzTmFtZSk7XG5cbiAgICAvLyBBZGQgdG8gdGhlIEZvdW5kYXRpb24gb2JqZWN0IGFuZCB0aGUgcGx1Z2lucyBsaXN0IChmb3IgcmVmbG93aW5nKVxuICAgIHRoaXMuX3BsdWdpbnNbYXR0ck5hbWVdID0gdGhpc1tjbGFzc05hbWVdID0gcGx1Z2luO1xuICB9LFxuICAvKipcbiAgICogQGZ1bmN0aW9uXG4gICAqIFBvcHVsYXRlcyB0aGUgX3V1aWRzIGFycmF5IHdpdGggcG9pbnRlcnMgdG8gZWFjaCBpbmRpdmlkdWFsIHBsdWdpbiBpbnN0YW5jZS5cbiAgICogQWRkcyB0aGUgYHpmUGx1Z2luYCBkYXRhLWF0dHJpYnV0ZSB0byBwcm9ncmFtbWF0aWNhbGx5IGNyZWF0ZWQgcGx1Z2lucyB0byBhbGxvdyB1c2Ugb2YgJChzZWxlY3RvcikuZm91bmRhdGlvbihtZXRob2QpIGNhbGxzLlxuICAgKiBBbHNvIGZpcmVzIHRoZSBpbml0aWFsaXphdGlvbiBldmVudCBmb3IgZWFjaCBwbHVnaW4sIGNvbnNvbGlkYXRpbmcgcmVwZXRpdGl2ZSBjb2RlLlxuICAgKiBAcGFyYW0ge09iamVjdH0gcGx1Z2luIC0gYW4gaW5zdGFuY2Ugb2YgYSBwbHVnaW4sIHVzdWFsbHkgYHRoaXNgIGluIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIC0gdGhlIG5hbWUgb2YgdGhlIHBsdWdpbiwgcGFzc2VkIGFzIGEgY2FtZWxDYXNlZCBzdHJpbmcuXG4gICAqIEBmaXJlcyBQbHVnaW4jaW5pdFxuICAgKi9cbiAgcmVnaXN0ZXJQbHVnaW46IGZ1bmN0aW9uKHBsdWdpbiwgbmFtZSl7XG4gICAgdmFyIHBsdWdpbk5hbWUgPSBuYW1lID8gaHlwaGVuYXRlKG5hbWUpIDogZnVuY3Rpb25OYW1lKHBsdWdpbi5jb25zdHJ1Y3RvcikudG9Mb3dlckNhc2UoKTtcbiAgICBwbHVnaW4udXVpZCA9IEdldFlvRGlnaXRzKDYsIHBsdWdpbk5hbWUpO1xuXG4gICAgaWYoIXBsdWdpbi4kZWxlbWVudC5hdHRyKGBkYXRhLSR7cGx1Z2luTmFtZX1gKSl7IHBsdWdpbi4kZWxlbWVudC5hdHRyKGBkYXRhLSR7cGx1Z2luTmFtZX1gLCBwbHVnaW4udXVpZCk7IH1cbiAgICBpZighcGx1Z2luLiRlbGVtZW50LmRhdGEoJ3pmUGx1Z2luJykpeyBwbHVnaW4uJGVsZW1lbnQuZGF0YSgnemZQbHVnaW4nLCBwbHVnaW4pOyB9XG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogRmlyZXMgd2hlbiB0aGUgcGx1Z2luIGhhcyBpbml0aWFsaXplZC5cbiAgICAgICAgICAgKiBAZXZlbnQgUGx1Z2luI2luaXRcbiAgICAgICAgICAgKi9cbiAgICBwbHVnaW4uJGVsZW1lbnQudHJpZ2dlcihgaW5pdC56Zi4ke3BsdWdpbk5hbWV9YCk7XG5cbiAgICB0aGlzLl91dWlkcy5wdXNoKHBsdWdpbi51dWlkKTtcblxuICAgIHJldHVybjtcbiAgfSxcbiAgLyoqXG4gICAqIEBmdW5jdGlvblxuICAgKiBSZW1vdmVzIHRoZSBwbHVnaW5zIHV1aWQgZnJvbSB0aGUgX3V1aWRzIGFycmF5LlxuICAgKiBSZW1vdmVzIHRoZSB6ZlBsdWdpbiBkYXRhIGF0dHJpYnV0ZSwgYXMgd2VsbCBhcyB0aGUgZGF0YS1wbHVnaW4tbmFtZSBhdHRyaWJ1dGUuXG4gICAqIEFsc28gZmlyZXMgdGhlIGRlc3Ryb3llZCBldmVudCBmb3IgdGhlIHBsdWdpbiwgY29uc29saWRhdGluZyByZXBldGl0aXZlIGNvZGUuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwbHVnaW4gLSBhbiBpbnN0YW5jZSBvZiBhIHBsdWdpbiwgdXN1YWxseSBgdGhpc2AgaW4gY29udGV4dC5cbiAgICogQGZpcmVzIFBsdWdpbiNkZXN0cm95ZWRcbiAgICovXG4gIHVucmVnaXN0ZXJQbHVnaW46IGZ1bmN0aW9uKHBsdWdpbil7XG4gICAgdmFyIHBsdWdpbk5hbWUgPSBoeXBoZW5hdGUoZnVuY3Rpb25OYW1lKHBsdWdpbi4kZWxlbWVudC5kYXRhKCd6ZlBsdWdpbicpLmNvbnN0cnVjdG9yKSk7XG5cbiAgICB0aGlzLl91dWlkcy5zcGxpY2UodGhpcy5fdXVpZHMuaW5kZXhPZihwbHVnaW4udXVpZCksIDEpO1xuICAgIHBsdWdpbi4kZWxlbWVudC5yZW1vdmVBdHRyKGBkYXRhLSR7cGx1Z2luTmFtZX1gKS5yZW1vdmVEYXRhKCd6ZlBsdWdpbicpXG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogRmlyZXMgd2hlbiB0aGUgcGx1Z2luIGhhcyBiZWVuIGRlc3Ryb3llZC5cbiAgICAgICAgICAgKiBAZXZlbnQgUGx1Z2luI2Rlc3Ryb3llZFxuICAgICAgICAgICAqL1xuICAgICAgICAgIC50cmlnZ2VyKGBkZXN0cm95ZWQuemYuJHtwbHVnaW5OYW1lfWApO1xuICAgIGZvcih2YXIgcHJvcCBpbiBwbHVnaW4pe1xuICAgICAgcGx1Z2luW3Byb3BdID0gbnVsbDsvL2NsZWFuIHVwIHNjcmlwdCB0byBwcmVwIGZvciBnYXJiYWdlIGNvbGxlY3Rpb24uXG4gICAgfVxuICAgIHJldHVybjtcbiAgfSxcblxuICAvKipcbiAgICogQGZ1bmN0aW9uXG4gICAqIENhdXNlcyBvbmUgb3IgbW9yZSBhY3RpdmUgcGx1Z2lucyB0byByZS1pbml0aWFsaXplLCByZXNldHRpbmcgZXZlbnQgbGlzdGVuZXJzLCByZWNhbGN1bGF0aW5nIHBvc2l0aW9ucywgZXRjLlxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGx1Z2lucyAtIG9wdGlvbmFsIHN0cmluZyBvZiBhbiBpbmRpdmlkdWFsIHBsdWdpbiBrZXksIGF0dGFpbmVkIGJ5IGNhbGxpbmcgYCQoZWxlbWVudCkuZGF0YSgncGx1Z2luTmFtZScpYCwgb3Igc3RyaW5nIG9mIGEgcGx1Z2luIGNsYXNzIGkuZS4gYCdkcm9wZG93bidgXG4gICAqIEBkZWZhdWx0IElmIG5vIGFyZ3VtZW50IGlzIHBhc3NlZCwgcmVmbG93IGFsbCBjdXJyZW50bHkgYWN0aXZlIHBsdWdpbnMuXG4gICAqL1xuICAgcmVJbml0OiBmdW5jdGlvbihwbHVnaW5zKXtcbiAgICAgdmFyIGlzSlEgPSBwbHVnaW5zIGluc3RhbmNlb2YgJDtcbiAgICAgdHJ5e1xuICAgICAgIGlmKGlzSlEpe1xuICAgICAgICAgcGx1Z2lucy5lYWNoKGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICQodGhpcykuZGF0YSgnemZQbHVnaW4nKS5faW5pdCgpO1xuICAgICAgICAgfSk7XG4gICAgICAgfWVsc2V7XG4gICAgICAgICB2YXIgdHlwZSA9IHR5cGVvZiBwbHVnaW5zLFxuICAgICAgICAgX3RoaXMgPSB0aGlzLFxuICAgICAgICAgZm5zID0ge1xuICAgICAgICAgICAnb2JqZWN0JzogZnVuY3Rpb24ocGxncyl7XG4gICAgICAgICAgICAgcGxncy5mb3JFYWNoKGZ1bmN0aW9uKHApe1xuICAgICAgICAgICAgICAgcCA9IGh5cGhlbmF0ZShwKTtcbiAgICAgICAgICAgICAgICQoJ1tkYXRhLScrIHAgKyddJykuZm91bmRhdGlvbignX2luaXQnKTtcbiAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgfSxcbiAgICAgICAgICAgJ3N0cmluZyc6IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgcGx1Z2lucyA9IGh5cGhlbmF0ZShwbHVnaW5zKTtcbiAgICAgICAgICAgICAkKCdbZGF0YS0nKyBwbHVnaW5zICsnXScpLmZvdW5kYXRpb24oJ19pbml0Jyk7XG4gICAgICAgICAgIH0sXG4gICAgICAgICAgICd1bmRlZmluZWQnOiBmdW5jdGlvbigpe1xuICAgICAgICAgICAgIHRoaXNbJ29iamVjdCddKE9iamVjdC5rZXlzKF90aGlzLl9wbHVnaW5zKSk7XG4gICAgICAgICAgIH1cbiAgICAgICAgIH07XG4gICAgICAgICBmbnNbdHlwZV0ocGx1Z2lucyk7XG4gICAgICAgfVxuICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgIH1maW5hbGx5e1xuICAgICAgIHJldHVybiBwbHVnaW5zO1xuICAgICB9XG4gICB9LFxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIHBsdWdpbnMgb24gYW55IGVsZW1lbnRzIHdpdGhpbiBgZWxlbWAgKGFuZCBgZWxlbWAgaXRzZWxmKSB0aGF0IGFyZW4ndCBhbHJlYWR5IGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge09iamVjdH0gZWxlbSAtIGpRdWVyeSBvYmplY3QgY29udGFpbmluZyB0aGUgZWxlbWVudCB0byBjaGVjayBpbnNpZGUuIEFsc28gY2hlY2tzIHRoZSBlbGVtZW50IGl0c2VsZiwgdW5sZXNzIGl0J3MgdGhlIGBkb2N1bWVudGAgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1N0cmluZ3xBcnJheX0gcGx1Z2lucyAtIEEgbGlzdCBvZiBwbHVnaW5zIHRvIGluaXRpYWxpemUuIExlYXZlIHRoaXMgb3V0IHRvIGluaXRpYWxpemUgZXZlcnl0aGluZy5cbiAgICovXG4gIHJlZmxvdzogZnVuY3Rpb24oZWxlbSwgcGx1Z2lucykge1xuXG4gICAgLy8gSWYgcGx1Z2lucyBpcyB1bmRlZmluZWQsIGp1c3QgZ3JhYiBldmVyeXRoaW5nXG4gICAgaWYgKHR5cGVvZiBwbHVnaW5zID09PSAndW5kZWZpbmVkJykge1xuICAgICAgcGx1Z2lucyA9IE9iamVjdC5rZXlzKHRoaXMuX3BsdWdpbnMpO1xuICAgIH1cbiAgICAvLyBJZiBwbHVnaW5zIGlzIGEgc3RyaW5nLCBjb252ZXJ0IGl0IHRvIGFuIGFycmF5IHdpdGggb25lIGl0ZW1cbiAgICBlbHNlIGlmICh0eXBlb2YgcGx1Z2lucyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBsdWdpbnMgPSBbcGx1Z2luc107XG4gICAgfVxuXG4gICAgdmFyIF90aGlzID0gdGhpcztcblxuICAgIC8vIEl0ZXJhdGUgdGhyb3VnaCBlYWNoIHBsdWdpblxuICAgICQuZWFjaChwbHVnaW5zLCBmdW5jdGlvbihpLCBuYW1lKSB7XG4gICAgICAvLyBHZXQgdGhlIGN1cnJlbnQgcGx1Z2luXG4gICAgICB2YXIgcGx1Z2luID0gX3RoaXMuX3BsdWdpbnNbbmFtZV07XG5cbiAgICAgIC8vIExvY2FsaXplIHRoZSBzZWFyY2ggdG8gYWxsIGVsZW1lbnRzIGluc2lkZSBlbGVtLCBhcyB3ZWxsIGFzIGVsZW0gaXRzZWxmLCB1bmxlc3MgZWxlbSA9PT0gZG9jdW1lbnRcbiAgICAgIHZhciAkZWxlbSA9ICQoZWxlbSkuZmluZCgnW2RhdGEtJytuYW1lKyddJykuYWRkQmFjaygnW2RhdGEtJytuYW1lKyddJyk7XG5cbiAgICAgIC8vIEZvciBlYWNoIHBsdWdpbiBmb3VuZCwgaW5pdGlhbGl6ZSBpdFxuICAgICAgJGVsZW0uZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyICRlbCA9ICQodGhpcyksXG4gICAgICAgICAgICBvcHRzID0ge307XG4gICAgICAgIC8vIERvbid0IGRvdWJsZS1kaXAgb24gcGx1Z2luc1xuICAgICAgICBpZiAoJGVsLmRhdGEoJ3pmUGx1Z2luJykpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXCJUcmllZCB0byBpbml0aWFsaXplIFwiK25hbWUrXCIgb24gYW4gZWxlbWVudCB0aGF0IGFscmVhZHkgaGFzIGEgRm91bmRhdGlvbiBwbHVnaW4uXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCRlbC5hdHRyKCdkYXRhLW9wdGlvbnMnKSl7XG4gICAgICAgICAgdmFyIHRoaW5nID0gJGVsLmF0dHIoJ2RhdGEtb3B0aW9ucycpLnNwbGl0KCc7JykuZm9yRWFjaChmdW5jdGlvbihlLCBpKXtcbiAgICAgICAgICAgIHZhciBvcHQgPSBlLnNwbGl0KCc6JykubWFwKGZ1bmN0aW9uKGVsKXsgcmV0dXJuIGVsLnRyaW0oKTsgfSk7XG4gICAgICAgICAgICBpZihvcHRbMF0pIG9wdHNbb3B0WzBdXSA9IHBhcnNlVmFsdWUob3B0WzFdKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICB0cnl7XG4gICAgICAgICAgJGVsLmRhdGEoJ3pmUGx1Z2luJywgbmV3IHBsdWdpbigkKHRoaXMpLCBvcHRzKSk7XG4gICAgICAgIH1jYXRjaChlcil7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihlcik7XG4gICAgICAgIH1maW5hbGx5e1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIGdldEZuTmFtZTogZnVuY3Rpb25OYW1lLFxuXG4gIGFkZFRvSnF1ZXJ5OiBmdW5jdGlvbigkKSB7XG4gICAgLy8gVE9ETzogY29uc2lkZXIgbm90IG1ha2luZyB0aGlzIGEgalF1ZXJ5IGZ1bmN0aW9uXG4gICAgLy8gVE9ETzogbmVlZCB3YXkgdG8gcmVmbG93IHZzLiByZS1pbml0aWFsaXplXG4gICAgLyoqXG4gICAgICogVGhlIEZvdW5kYXRpb24galF1ZXJ5IG1ldGhvZC5cbiAgICAgKiBAcGFyYW0ge1N0cmluZ3xBcnJheX0gbWV0aG9kIC0gQW4gYWN0aW9uIHRvIHBlcmZvcm0gb24gdGhlIGN1cnJlbnQgalF1ZXJ5IG9iamVjdC5cbiAgICAgKi9cbiAgICB2YXIgZm91bmRhdGlvbiA9IGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgdmFyIHR5cGUgPSB0eXBlb2YgbWV0aG9kLFxuICAgICAgICAgICRub0pTID0gJCgnLm5vLWpzJyk7XG5cbiAgICAgIGlmKCRub0pTLmxlbmd0aCl7XG4gICAgICAgICRub0pTLnJlbW92ZUNsYXNzKCduby1qcycpO1xuICAgICAgfVxuXG4gICAgICBpZih0eXBlID09PSAndW5kZWZpbmVkJyl7Ly9uZWVkcyB0byBpbml0aWFsaXplIHRoZSBGb3VuZGF0aW9uIG9iamVjdCwgb3IgYW4gaW5kaXZpZHVhbCBwbHVnaW4uXG4gICAgICAgIE1lZGlhUXVlcnkuX2luaXQoKTtcbiAgICAgICAgRm91bmRhdGlvbi5yZWZsb3codGhpcyk7XG4gICAgICB9ZWxzZSBpZih0eXBlID09PSAnc3RyaW5nJyl7Ly9hbiBpbmRpdmlkdWFsIG1ldGhvZCB0byBpbnZva2Ugb24gYSBwbHVnaW4gb3IgZ3JvdXAgb2YgcGx1Z2luc1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7Ly9jb2xsZWN0IGFsbCB0aGUgYXJndW1lbnRzLCBpZiBuZWNlc3NhcnlcbiAgICAgICAgdmFyIHBsdWdDbGFzcyA9IHRoaXMuZGF0YSgnemZQbHVnaW4nKTsvL2RldGVybWluZSB0aGUgY2xhc3Mgb2YgcGx1Z2luXG5cbiAgICAgICAgaWYocGx1Z0NsYXNzICE9PSB1bmRlZmluZWQgJiYgcGx1Z0NsYXNzW21ldGhvZF0gIT09IHVuZGVmaW5lZCl7Ly9tYWtlIHN1cmUgYm90aCB0aGUgY2xhc3MgYW5kIG1ldGhvZCBleGlzdFxuICAgICAgICAgIGlmKHRoaXMubGVuZ3RoID09PSAxKXsvL2lmIHRoZXJlJ3Mgb25seSBvbmUsIGNhbGwgaXQgZGlyZWN0bHkuXG4gICAgICAgICAgICAgIHBsdWdDbGFzc1ttZXRob2RdLmFwcGx5KHBsdWdDbGFzcywgYXJncyk7XG4gICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24oaSwgZWwpey8vb3RoZXJ3aXNlIGxvb3AgdGhyb3VnaCB0aGUgalF1ZXJ5IGNvbGxlY3Rpb24gYW5kIGludm9rZSB0aGUgbWV0aG9kIG9uIGVhY2hcbiAgICAgICAgICAgICAgcGx1Z0NsYXNzW21ldGhvZF0uYXBwbHkoJChlbCkuZGF0YSgnemZQbHVnaW4nKSwgYXJncyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1lbHNley8vZXJyb3IgZm9yIG5vIGNsYXNzIG9yIG5vIG1ldGhvZFxuICAgICAgICAgIHRocm93IG5ldyBSZWZlcmVuY2VFcnJvcihcIldlJ3JlIHNvcnJ5LCAnXCIgKyBtZXRob2QgKyBcIicgaXMgbm90IGFuIGF2YWlsYWJsZSBtZXRob2QgZm9yIFwiICsgKHBsdWdDbGFzcyA/IGZ1bmN0aW9uTmFtZShwbHVnQ2xhc3MpIDogJ3RoaXMgZWxlbWVudCcpICsgJy4nKTtcbiAgICAgICAgfVxuICAgICAgfWVsc2V7Ly9lcnJvciBmb3IgaW52YWxpZCBhcmd1bWVudCB0eXBlXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYFdlJ3JlIHNvcnJ5LCAke3R5cGV9IGlzIG5vdCBhIHZhbGlkIHBhcmFtZXRlci4gWW91IG11c3QgdXNlIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgbWV0aG9kIHlvdSB3aXNoIHRvIGludm9rZS5gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG4gICAgJC5mbi5mb3VuZGF0aW9uID0gZm91bmRhdGlvbjtcbiAgICByZXR1cm4gJDtcbiAgfVxufTtcblxuRm91bmRhdGlvbi51dGlsID0ge1xuICAvKipcbiAgICogRnVuY3Rpb24gZm9yIGFwcGx5aW5nIGEgZGVib3VuY2UgZWZmZWN0IHRvIGEgZnVuY3Rpb24gY2FsbC5cbiAgICogQGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgLSBGdW5jdGlvbiB0byBiZSBjYWxsZWQgYXQgZW5kIG9mIHRpbWVvdXQuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBkZWxheSAtIFRpbWUgaW4gbXMgdG8gZGVsYXkgdGhlIGNhbGwgb2YgYGZ1bmNgLlxuICAgKiBAcmV0dXJucyBmdW5jdGlvblxuICAgKi9cbiAgdGhyb3R0bGU6IGZ1bmN0aW9uIChmdW5jLCBkZWxheSkge1xuICAgIHZhciB0aW1lciA9IG51bGw7XG5cbiAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIGNvbnRleHQgPSB0aGlzLCBhcmdzID0gYXJndW1lbnRzO1xuXG4gICAgICBpZiAodGltZXIgPT09IG51bGwpIHtcbiAgICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgICAgIHRpbWVyID0gbnVsbDtcbiAgICAgICAgfSwgZGVsYXkpO1xuICAgICAgfVxuICAgIH07XG4gIH1cbn07XG5cbndpbmRvdy5Gb3VuZGF0aW9uID0gRm91bmRhdGlvbjtcblxuLy8gUG9seWZpbGwgZm9yIHJlcXVlc3RBbmltYXRpb25GcmFtZVxuKGZ1bmN0aW9uKCkge1xuICBpZiAoIURhdGUubm93IHx8ICF3aW5kb3cuRGF0ZS5ub3cpXG4gICAgd2luZG93LkRhdGUubm93ID0gRGF0ZS5ub3cgPSBmdW5jdGlvbigpIHsgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZSgpOyB9O1xuXG4gIHZhciB2ZW5kb3JzID0gWyd3ZWJraXQnLCAnbW96J107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmVuZG9ycy5sZW5ndGggJiYgIXdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWU7ICsraSkge1xuICAgICAgdmFyIHZwID0gdmVuZG9yc1tpXTtcbiAgICAgIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSB3aW5kb3dbdnArJ1JlcXVlc3RBbmltYXRpb25GcmFtZSddO1xuICAgICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lID0gKHdpbmRvd1t2cCsnQ2FuY2VsQW5pbWF0aW9uRnJhbWUnXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgd2luZG93W3ZwKydDYW5jZWxSZXF1ZXN0QW5pbWF0aW9uRnJhbWUnXSk7XG4gIH1cbiAgaWYgKC9pUChhZHxob25lfG9kKS4qT1MgNi8udGVzdCh3aW5kb3cubmF2aWdhdG9yLnVzZXJBZ2VudClcbiAgICB8fCAhd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSB8fCAhd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKSB7XG4gICAgdmFyIGxhc3RUaW1lID0gMDtcbiAgICB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgIHZhciBuZXh0VGltZSA9IE1hdGgubWF4KGxhc3RUaW1lICsgMTYsIG5vdyk7XG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBjYWxsYmFjayhsYXN0VGltZSA9IG5leHRUaW1lKTsgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFRpbWUgLSBub3cpO1xuICAgIH07XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lID0gY2xlYXJUaW1lb3V0O1xuICB9XG4gIC8qKlxuICAgKiBQb2x5ZmlsbCBmb3IgcGVyZm9ybWFuY2Uubm93LCByZXF1aXJlZCBieSByQUZcbiAgICovXG4gIGlmKCF3aW5kb3cucGVyZm9ybWFuY2UgfHwgIXdpbmRvdy5wZXJmb3JtYW5jZS5ub3cpe1xuICAgIHdpbmRvdy5wZXJmb3JtYW5jZSA9IHtcbiAgICAgIHN0YXJ0OiBEYXRlLm5vdygpLFxuICAgICAgbm93OiBmdW5jdGlvbigpeyByZXR1cm4gRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnQ7IH1cbiAgICB9O1xuICB9XG59KSgpO1xuaWYgKCFGdW5jdGlvbi5wcm90b3R5cGUuYmluZCkge1xuICBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCA9IGZ1bmN0aW9uKG9UaGlzKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBjbG9zZXN0IHRoaW5nIHBvc3NpYmxlIHRvIHRoZSBFQ01BU2NyaXB0IDVcbiAgICAgIC8vIGludGVybmFsIElzQ2FsbGFibGUgZnVuY3Rpb25cbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0Z1bmN0aW9uLnByb3RvdHlwZS5iaW5kIC0gd2hhdCBpcyB0cnlpbmcgdG8gYmUgYm91bmQgaXMgbm90IGNhbGxhYmxlJyk7XG4gICAgfVxuXG4gICAgdmFyIGFBcmdzICAgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICBmVG9CaW5kID0gdGhpcyxcbiAgICAgICAgZk5PUCAgICA9IGZ1bmN0aW9uKCkge30sXG4gICAgICAgIGZCb3VuZCAgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gZlRvQmluZC5hcHBseSh0aGlzIGluc3RhbmNlb2YgZk5PUFxuICAgICAgICAgICAgICAgICA/IHRoaXNcbiAgICAgICAgICAgICAgICAgOiBvVGhpcyxcbiAgICAgICAgICAgICAgICAgYUFyZ3MuY29uY2F0KEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgICAgfTtcblxuICAgIGlmICh0aGlzLnByb3RvdHlwZSkge1xuICAgICAgLy8gbmF0aXZlIGZ1bmN0aW9ucyBkb24ndCBoYXZlIGEgcHJvdG90eXBlXG4gICAgICBmTk9QLnByb3RvdHlwZSA9IHRoaXMucHJvdG90eXBlO1xuICAgIH1cbiAgICBmQm91bmQucHJvdG90eXBlID0gbmV3IGZOT1AoKTtcblxuICAgIHJldHVybiBmQm91bmQ7XG4gIH07XG59XG4vLyBQb2x5ZmlsbCB0byBnZXQgdGhlIG5hbWUgb2YgYSBmdW5jdGlvbiBpbiBJRTlcbmZ1bmN0aW9uIGZ1bmN0aW9uTmFtZShmbikge1xuICBpZiAoRnVuY3Rpb24ucHJvdG90eXBlLm5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHZhciBmdW5jTmFtZVJlZ2V4ID0gL2Z1bmN0aW9uXFxzKFteKF17MSx9KVxcKC87XG4gICAgdmFyIHJlc3VsdHMgPSAoZnVuY05hbWVSZWdleCkuZXhlYygoZm4pLnRvU3RyaW5nKCkpO1xuICAgIHJldHVybiAocmVzdWx0cyAmJiByZXN1bHRzLmxlbmd0aCA+IDEpID8gcmVzdWx0c1sxXS50cmltKCkgOiBcIlwiO1xuICB9XG4gIGVsc2UgaWYgKGZuLnByb3RvdHlwZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGZuLmNvbnN0cnVjdG9yLm5hbWU7XG4gIH1cbiAgZWxzZSB7XG4gICAgcmV0dXJuIGZuLnByb3RvdHlwZS5jb25zdHJ1Y3Rvci5uYW1lO1xuICB9XG59XG5mdW5jdGlvbiBwYXJzZVZhbHVlKHN0cil7XG4gIGlmICgndHJ1ZScgPT09IHN0cikgcmV0dXJuIHRydWU7XG4gIGVsc2UgaWYgKCdmYWxzZScgPT09IHN0cikgcmV0dXJuIGZhbHNlO1xuICBlbHNlIGlmICghaXNOYU4oc3RyICogMSkpIHJldHVybiBwYXJzZUZsb2F0KHN0cik7XG4gIHJldHVybiBzdHI7XG59XG4vLyBDb252ZXJ0IFBhc2NhbENhc2UgdG8ga2ViYWItY2FzZVxuLy8gVGhhbmsgeW91OiBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS84OTU1NTgwXG5mdW5jdGlvbiBoeXBoZW5hdGUoc3RyKSB7XG4gIHJldHVybiBzdHIucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgJyQxLSQyJykudG9Mb3dlckNhc2UoKTtcbn1cblxuZXhwb3J0IHtGb3VuZGF0aW9ufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuaW1wb3J0ICQgZnJvbSAnanF1ZXJ5JztcblxuLy8gRGVmYXVsdCBzZXQgb2YgbWVkaWEgcXVlcmllc1xuY29uc3QgZGVmYXVsdFF1ZXJpZXMgPSB7XG4gICdkZWZhdWx0JyA6ICdvbmx5IHNjcmVlbicsXG4gIGxhbmRzY2FwZSA6ICdvbmx5IHNjcmVlbiBhbmQgKG9yaWVudGF0aW9uOiBsYW5kc2NhcGUpJyxcbiAgcG9ydHJhaXQgOiAnb25seSBzY3JlZW4gYW5kIChvcmllbnRhdGlvbjogcG9ydHJhaXQpJyxcbiAgcmV0aW5hIDogJ29ubHkgc2NyZWVuIGFuZCAoLXdlYmtpdC1taW4tZGV2aWNlLXBpeGVsLXJhdGlvOiAyKSwnICtcbiAgICAnb25seSBzY3JlZW4gYW5kIChtaW4tLW1vei1kZXZpY2UtcGl4ZWwtcmF0aW86IDIpLCcgK1xuICAgICdvbmx5IHNjcmVlbiBhbmQgKC1vLW1pbi1kZXZpY2UtcGl4ZWwtcmF0aW86IDIvMSksJyArXG4gICAgJ29ubHkgc2NyZWVuIGFuZCAobWluLWRldmljZS1waXhlbC1yYXRpbzogMiksJyArXG4gICAgJ29ubHkgc2NyZWVuIGFuZCAobWluLXJlc29sdXRpb246IDE5MmRwaSksJyArXG4gICAgJ29ubHkgc2NyZWVuIGFuZCAobWluLXJlc29sdXRpb246IDJkcHB4KSdcbiAgfTtcblxuXG4vLyBtYXRjaE1lZGlhKCkgcG9seWZpbGwgLSBUZXN0IGEgQ1NTIG1lZGlhIHR5cGUvcXVlcnkgaW4gSlMuXG4vLyBBdXRob3JzICYgY29weXJpZ2h0IChjKSAyMDEyOiBTY290dCBKZWhsLCBQYXVsIElyaXNoLCBOaWNob2xhcyBaYWthcywgRGF2aWQgS25pZ2h0LiBEdWFsIE1JVC9CU0QgbGljZW5zZVxubGV0IG1hdGNoTWVkaWEgPSB3aW5kb3cubWF0Y2hNZWRpYSB8fCAoZnVuY3Rpb24oKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICAvLyBGb3IgYnJvd3NlcnMgdGhhdCBzdXBwb3J0IG1hdGNoTWVkaXVtIGFwaSBzdWNoIGFzIElFIDkgYW5kIHdlYmtpdFxuICB2YXIgc3R5bGVNZWRpYSA9ICh3aW5kb3cuc3R5bGVNZWRpYSB8fCB3aW5kb3cubWVkaWEpO1xuXG4gIC8vIEZvciB0aG9zZSB0aGF0IGRvbid0IHN1cHBvcnQgbWF0Y2hNZWRpdW1cbiAgaWYgKCFzdHlsZU1lZGlhKSB7XG4gICAgdmFyIHN0eWxlICAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpLFxuICAgIHNjcmlwdCAgICAgID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3NjcmlwdCcpWzBdLFxuICAgIGluZm8gICAgICAgID0gbnVsbDtcblxuICAgIHN0eWxlLnR5cGUgID0gJ3RleHQvY3NzJztcbiAgICBzdHlsZS5pZCAgICA9ICdtYXRjaG1lZGlhanMtdGVzdCc7XG5cbiAgICBzY3JpcHQgJiYgc2NyaXB0LnBhcmVudE5vZGUgJiYgc2NyaXB0LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHN0eWxlLCBzY3JpcHQpO1xuXG4gICAgLy8gJ3N0eWxlLmN1cnJlbnRTdHlsZScgaXMgdXNlZCBieSBJRSA8PSA4IGFuZCAnd2luZG93LmdldENvbXB1dGVkU3R5bGUnIGZvciBhbGwgb3RoZXIgYnJvd3NlcnNcbiAgICBpbmZvID0gKCdnZXRDb21wdXRlZFN0eWxlJyBpbiB3aW5kb3cpICYmIHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHN0eWxlLCBudWxsKSB8fCBzdHlsZS5jdXJyZW50U3R5bGU7XG5cbiAgICBzdHlsZU1lZGlhID0ge1xuICAgICAgbWF0Y2hNZWRpdW0obWVkaWEpIHtcbiAgICAgICAgdmFyIHRleHQgPSBgQG1lZGlhICR7bWVkaWF9eyAjbWF0Y2htZWRpYWpzLXRlc3QgeyB3aWR0aDogMXB4OyB9IH1gO1xuXG4gICAgICAgIC8vICdzdHlsZS5zdHlsZVNoZWV0JyBpcyB1c2VkIGJ5IElFIDw9IDggYW5kICdzdHlsZS50ZXh0Q29udGVudCcgZm9yIGFsbCBvdGhlciBicm93c2Vyc1xuICAgICAgICBpZiAoc3R5bGUuc3R5bGVTaGVldCkge1xuICAgICAgICAgIHN0eWxlLnN0eWxlU2hlZXQuY3NzVGV4dCA9IHRleHQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3R5bGUudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGVzdCBpZiBtZWRpYSBxdWVyeSBpcyB0cnVlIG9yIGZhbHNlXG4gICAgICAgIHJldHVybiBpbmZvLndpZHRoID09PSAnMXB4JztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24obWVkaWEpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbWF0Y2hlczogc3R5bGVNZWRpYS5tYXRjaE1lZGl1bShtZWRpYSB8fCAnYWxsJyksXG4gICAgICBtZWRpYTogbWVkaWEgfHwgJ2FsbCdcbiAgICB9O1xuICB9XG59KSgpO1xuXG52YXIgTWVkaWFRdWVyeSA9IHtcbiAgcXVlcmllczogW10sXG5cbiAgY3VycmVudDogJycsXG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIHRoZSBtZWRpYSBxdWVyeSBoZWxwZXIsIGJ5IGV4dHJhY3RpbmcgdGhlIGJyZWFrcG9pbnQgbGlzdCBmcm9tIHRoZSBDU1MgYW5kIGFjdGl2YXRpbmcgdGhlIGJyZWFrcG9pbnQgd2F0Y2hlci5cbiAgICogQGZ1bmN0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBfaW5pdCgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyICRtZXRhID0gJCgnbWV0YS5mb3VuZGF0aW9uLW1xJyk7XG4gICAgaWYoISRtZXRhLmxlbmd0aCl7XG4gICAgICAkKCc8bWV0YSBjbGFzcz1cImZvdW5kYXRpb24tbXFcIj4nKS5hcHBlbmRUbyhkb2N1bWVudC5oZWFkKTtcbiAgICB9XG5cbiAgICB2YXIgZXh0cmFjdGVkU3R5bGVzID0gJCgnLmZvdW5kYXRpb24tbXEnKS5jc3MoJ2ZvbnQtZmFtaWx5Jyk7XG4gICAgdmFyIG5hbWVkUXVlcmllcztcblxuICAgIG5hbWVkUXVlcmllcyA9IHBhcnNlU3R5bGVUb09iamVjdChleHRyYWN0ZWRTdHlsZXMpO1xuXG4gICAgZm9yICh2YXIga2V5IGluIG5hbWVkUXVlcmllcykge1xuICAgICAgaWYobmFtZWRRdWVyaWVzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgc2VsZi5xdWVyaWVzLnB1c2goe1xuICAgICAgICAgIG5hbWU6IGtleSxcbiAgICAgICAgICB2YWx1ZTogYG9ubHkgc2NyZWVuIGFuZCAobWluLXdpZHRoOiAke25hbWVkUXVlcmllc1trZXldfSlgXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY3VycmVudCA9IHRoaXMuX2dldEN1cnJlbnRTaXplKCk7XG5cbiAgICB0aGlzLl93YXRjaGVyKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiB0aGUgc2NyZWVuIGlzIGF0IGxlYXN0IGFzIHdpZGUgYXMgYSBicmVha3BvaW50LlxuICAgKiBAZnVuY3Rpb25cbiAgICogQHBhcmFtIHtTdHJpbmd9IHNpemUgLSBOYW1lIG9mIHRoZSBicmVha3BvaW50IHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7Qm9vbGVhbn0gYHRydWVgIGlmIHRoZSBicmVha3BvaW50IG1hdGNoZXMsIGBmYWxzZWAgaWYgaXQncyBzbWFsbGVyLlxuICAgKi9cbiAgYXRMZWFzdChzaXplKSB7XG4gICAgdmFyIHF1ZXJ5ID0gdGhpcy5nZXQoc2l6ZSk7XG5cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHJldHVybiBtYXRjaE1lZGlhKHF1ZXJ5KS5tYXRjaGVzO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRoZSBzY3JlZW4gbWF0Y2hlcyB0byBhIGJyZWFrcG9pbnQuXG4gICAqIEBmdW5jdGlvblxuICAgKiBAcGFyYW0ge1N0cmluZ30gc2l6ZSAtIE5hbWUgb2YgdGhlIGJyZWFrcG9pbnQgdG8gY2hlY2ssIGVpdGhlciAnc21hbGwgb25seScgb3IgJ3NtYWxsJy4gT21pdHRpbmcgJ29ubHknIGZhbGxzIGJhY2sgdG8gdXNpbmcgYXRMZWFzdCgpIG1ldGhvZC5cbiAgICogQHJldHVybnMge0Jvb2xlYW59IGB0cnVlYCBpZiB0aGUgYnJlYWtwb2ludCBtYXRjaGVzLCBgZmFsc2VgIGlmIGl0IGRvZXMgbm90LlxuICAgKi9cbiAgaXMoc2l6ZSkge1xuICAgIHNpemUgPSBzaXplLnRyaW0oKS5zcGxpdCgnICcpO1xuICAgIGlmKHNpemUubGVuZ3RoID4gMSAmJiBzaXplWzFdID09PSAnb25seScpIHtcbiAgICAgIGlmKHNpemVbMF0gPT09IHRoaXMuX2dldEN1cnJlbnRTaXplKCkpIHJldHVybiB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5hdExlYXN0KHNpemVbMF0pO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIG1lZGlhIHF1ZXJ5IG9mIGEgYnJlYWtwb2ludC5cbiAgICogQGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzaXplIC0gTmFtZSBvZiB0aGUgYnJlYWtwb2ludCB0byBnZXQuXG4gICAqIEByZXR1cm5zIHtTdHJpbmd8bnVsbH0gLSBUaGUgbWVkaWEgcXVlcnkgb2YgdGhlIGJyZWFrcG9pbnQsIG9yIGBudWxsYCBpZiB0aGUgYnJlYWtwb2ludCBkb2Vzbid0IGV4aXN0LlxuICAgKi9cbiAgZ2V0KHNpemUpIHtcbiAgICBmb3IgKHZhciBpIGluIHRoaXMucXVlcmllcykge1xuICAgICAgaWYodGhpcy5xdWVyaWVzLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgIHZhciBxdWVyeSA9IHRoaXMucXVlcmllc1tpXTtcbiAgICAgICAgaWYgKHNpemUgPT09IHF1ZXJ5Lm5hbWUpIHJldHVybiBxdWVyeS52YWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfSxcblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCBicmVha3BvaW50IG5hbWUgYnkgdGVzdGluZyBldmVyeSBicmVha3BvaW50IGFuZCByZXR1cm5pbmcgdGhlIGxhc3Qgb25lIHRvIG1hdGNoICh0aGUgYmlnZ2VzdCBvbmUpLlxuICAgKiBAZnVuY3Rpb25cbiAgICogQHByaXZhdGVcbiAgICogQHJldHVybnMge1N0cmluZ30gTmFtZSBvZiB0aGUgY3VycmVudCBicmVha3BvaW50LlxuICAgKi9cbiAgX2dldEN1cnJlbnRTaXplKCkge1xuICAgIHZhciBtYXRjaGVkO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnF1ZXJpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBxdWVyeSA9IHRoaXMucXVlcmllc1tpXTtcblxuICAgICAgaWYgKG1hdGNoTWVkaWEocXVlcnkudmFsdWUpLm1hdGNoZXMpIHtcbiAgICAgICAgbWF0Y2hlZCA9IHF1ZXJ5O1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgbWF0Y2hlZCA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBtYXRjaGVkLm5hbWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBtYXRjaGVkO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQWN0aXZhdGVzIHRoZSBicmVha3BvaW50IHdhdGNoZXIsIHdoaWNoIGZpcmVzIGFuIGV2ZW50IG9uIHRoZSB3aW5kb3cgd2hlbmV2ZXIgdGhlIGJyZWFrcG9pbnQgY2hhbmdlcy5cbiAgICogQGZ1bmN0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBfd2F0Y2hlcigpIHtcbiAgICAkKHdpbmRvdykub2ZmKCdyZXNpemUuemYubWVkaWFxdWVyeScpLm9uKCdyZXNpemUuemYubWVkaWFxdWVyeScsICgpID0+IHtcbiAgICAgIHZhciBuZXdTaXplID0gdGhpcy5fZ2V0Q3VycmVudFNpemUoKSwgY3VycmVudFNpemUgPSB0aGlzLmN1cnJlbnQ7XG5cbiAgICAgIGlmIChuZXdTaXplICE9PSBjdXJyZW50U2l6ZSkge1xuICAgICAgICAvLyBDaGFuZ2UgdGhlIGN1cnJlbnQgbWVkaWEgcXVlcnlcbiAgICAgICAgdGhpcy5jdXJyZW50ID0gbmV3U2l6ZTtcblxuICAgICAgICAvLyBCcm9hZGNhc3QgdGhlIG1lZGlhIHF1ZXJ5IGNoYW5nZSBvbiB0aGUgd2luZG93XG4gICAgICAgICQod2luZG93KS50cmlnZ2VyKCdjaGFuZ2VkLnpmLm1lZGlhcXVlcnknLCBbbmV3U2l6ZSwgY3VycmVudFNpemVdKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufTtcblxuXG5cbi8vIFRoYW5rIHlvdTogaHR0cHM6Ly9naXRodWIuY29tL3NpbmRyZXNvcmh1cy9xdWVyeS1zdHJpbmdcbmZ1bmN0aW9uIHBhcnNlU3R5bGVUb09iamVjdChzdHIpIHtcbiAgdmFyIHN0eWxlT2JqZWN0ID0ge307XG5cbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHN0eWxlT2JqZWN0O1xuICB9XG5cbiAgc3RyID0gc3RyLnRyaW0oKS5zbGljZSgxLCAtMSk7IC8vIGJyb3dzZXJzIHJlLXF1b3RlIHN0cmluZyBzdHlsZSB2YWx1ZXNcblxuICBpZiAoIXN0cikge1xuICAgIHJldHVybiBzdHlsZU9iamVjdDtcbiAgfVxuXG4gIHN0eWxlT2JqZWN0ID0gc3RyLnNwbGl0KCcmJykucmVkdWNlKGZ1bmN0aW9uKHJldCwgcGFyYW0pIHtcbiAgICB2YXIgcGFydHMgPSBwYXJhbS5yZXBsYWNlKC9cXCsvZywgJyAnKS5zcGxpdCgnPScpO1xuICAgIHZhciBrZXkgPSBwYXJ0c1swXTtcbiAgICB2YXIgdmFsID0gcGFydHNbMV07XG4gICAga2V5ID0gZGVjb2RlVVJJQ29tcG9uZW50KGtleSk7XG5cbiAgICAvLyBtaXNzaW5nIGA9YCBzaG91bGQgYmUgYG51bGxgOlxuICAgIC8vIGh0dHA6Ly93My5vcmcvVFIvMjAxMi9XRC11cmwtMjAxMjA1MjQvI2NvbGxlY3QtdXJsLXBhcmFtZXRlcnNcbiAgICB2YWwgPSB2YWwgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBkZWNvZGVVUklDb21wb25lbnQodmFsKTtcblxuICAgIGlmICghcmV0Lmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgIHJldFtrZXldID0gdmFsO1xuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShyZXRba2V5XSkpIHtcbiAgICAgIHJldFtrZXldLnB1c2godmFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0W2tleV0gPSBbcmV0W2tleV0sIHZhbF07XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG4gIH0sIHt9KTtcblxuICByZXR1cm4gc3R5bGVPYmplY3Q7XG59XG5cbmV4cG9ydCB7TWVkaWFRdWVyeX07XG4iLCIvKipcbiAqIEBmaWxlIGluamVjdC1zdmcuanNcbiAqXG4gKiBVc2Ugc3ZnLWluamVjdG9yLmpzIHRvIHJlcGxhY2UgYW4gc3ZnIDxpbWc+IHRhZyB3aXRoIHRoZSBpbmxpbmUgc3ZnLlxuICovXG5cbihmdW5jdGlvbigkLCBkb2N1bWVudCl7XG4gIFwidXNlIHN0cmljdFwiO1xuXG4gICQoKCkgPT4ge1xuICAgIC8vIEVsZW1lbnRzIHRvIGluamVjdFxuICAgIGxldCBteVNWR3NUb0luamVjdCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ2ltZy5pbmplY3QtbWUnKTtcblxuICAgIC8vIERvIHRoZSBpbmplY3Rpb25cbiAgICAvKiBnbG9iYWwgU1ZHSW5qZWN0b3IgKi9cbiAgICBuZXcgU1ZHSW5qZWN0b3IobXlTVkdzVG9JbmplY3QpO1xuICB9KTtcblxufSkoalF1ZXJ5LCBkb2N1bWVudCk7XG5cbiIsIi8qKlxuICogdGhlbWUuanNcbiAqIEVudHJ5IHBvaW50IGZvciBhbGwgdGhlbWUgcmVsYXRlZCBqcy5cbiAqL1xuXG4oZnVuY3Rpb24oJCl7XG4gIFwidXNlIHN0cmljdFwiO1xuXG4gICQoKCkgPT4ge1xuXG4gIH0pO1xuXG59KShqUXVlcnkpO1xuIl19
