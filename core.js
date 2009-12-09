// ==========================================================================
// Project:   Animate
// Copyright: ©2009 TPSi
// Copyright: ©2009 Alex Iskander
// ==========================================================================
/*globals Animate */

/** @namespace
	A simple mixin called Animatable is provided. What does it do?
	It makes CSS transitions for you, and if they aren't available,
	implements them in JavaScript.
	
	Current good things:
		- Seems to work!
		- Animates 300 SC.LabelViews acceptably with only JavaScript. Animates >500
		  just as well (if not better) with CSS transitions.
		- Automatically detects if CSS transitions are available.
		
	Current flaws:
		- Likely somewhat buggy. Haven't seen any bugs, though... Please tell me.
		- Not very configurable. Should at LEAST allow (preset) interpolation
		  functions.
	
	Animatable things:
		- layout. You can animate any layout property, even centerX and centerY
		- opacity.
		- display, in a way. All animating display does is delay setting display:none
		  until <em>after</em> the transition duration has passed. This allows you
		  to set display:none after fading out.
		
	@example Example Usage:
	{{{
		aView: SC.LabelView.design(Animate.Animatable, {
			transitions: {
				left: {duration: .25},
				top: .25 // only possible during design; otherwise you must use long form.
			}
		})
	}}}
  @extends SC.Object
*/
Animate = SC.Object.create(
/** @scope Animate.prototype */ {

	NAMESPACE: 'Animate',
	VERSION: '0.1.0',
	
	// I'm about to hack a very poor memory-wise, but hopefully fast CPU-wise, thingy.
	baseTimer: {
		next: null
	},
	going: false,
	interval: 10,
	currentTime: new Date().getTime(),
	
	enableCSSTransitions: false, // automatically calculated. You can override, but only from OUTSIDE.
	
	lastFPS: 0, // the average FPS for the last sequence of animations.
	_ticks: 0,
	_timer_start_time: null,
	
	addTimer: function(animator)
	{
		animator.next = Animate.baseTimer.next;
		Animate.baseTimer.next = animator;
		animator.going = true;
		if (!Animate.going) Animate.start();
	},
	
	start: function()
	{
		Animate._ticks = 0;
		Animate._timer_start_time = new Date().getTime();
		Animate.going = true;
		
		// set a timeout so tick only runs AFTER any pending animation timers are set.
		setTimeout(Animate.timeout, 0);
	},
	
	timeout: function()
	{	
		Animate.currentTime = new Date().getTime();
		var start = Animate.currentTime;
		
		var next = Animate.baseTimer.next;
		Animate.baseTimer.next = null;
		var i = 0;
		while (next)
		{
			var t = next.next;
			next.next = null;
			next.action.call(next, start);
			next = t;
			i++;
		}
	
		// built-in FPS counter, so that FPS is only counted DURING animation.
		// is there a way to make the minifier get rid of this? Because that would be lovely.
		// still, only called once per frame, so should _very_ minimally impact performance and memory.
		if (Animate._ticks < 1000000) Animate._ticks++; // okay, put _some_ limit on it
		
		// now see about doing next bit...	
		var end = new Date().getTime();
		var elapsed = end - start;
		if (Animate.baseTimer.next)
		{
			setTimeout(function(){ Animate.timeout(); }, Math.max(0, Animate.interval - elapsed));
		}
		else
		{
			// we're done... so calculate FPS
			Animate.going = false;
			
			// get diff
			var time_diff = end - Animate._timer_start_time;
			var loop = SC.RunLoop.begin();
			Animate.set("lastFPS", Animate._ticks / (time_diff / 1000));
			loop.end();
		}
	},
	
	
	Animatable: {
		transitions: {},
		concatenatedProperties: ["transitions"],
		
		/**
			The style properties. Works somewhat similarly to layout properties, though
			is a tad bit simpler, as it does not involve parent views at all.
		*/
		style: { },
		
		// collections of CSS transitions we have available
		_cssTransitionFor: {
			"left": "left", "top": "top", 
			"right": "right", "bottom": "bottom",
			"width": "width", "height": "height",
			"opacity": "opacity"
		},
		
		// properties that adjust should relay to style
		_styleProperties: [ "opacity", "display" ],
		_layoutStyles: ["left", "right", "top", "bottom", "width", "height", "centerX", "centerY"],
		
		// we cache this dictionary so we don't generate a new one each time we make
		// a new animation. It is used so we can start the animations in order—
		// for instance, centerX and centerY need to be animated _after_ width and height.
		_animationsToStart: {},
		
		// and, said animation order
		_animationOrder: ["top", "left", "bottom", "right", "width", "height", "centerX", "centerY", "opacity", "display"],
		
		
		initMixin: function()
		{
			// substitute our didUpdateLayer method (but saving the old one)
			this._animatable_original_did_update_layer = this.didUpdateLayer || function(){};
			this.didUpdateLayer = this._animatable_did_update_layer;
			
			// for debugging
			this._animateTickPixel.displayName = "animate-tick";
			
			// if transitions was concatenated...
			var i;
			if (SC.isArray(this.transitions))
			{
				var tl = {}; // prepare a new one mixed in
				for (i = 0; i < this.transitions.length; i++)
				{
					SC.mixin(tl, this.transitions[i]);
				}
				this.transitions = tl;
			}
			
			// go through transitions and make duration-only ones follow normal pattern
			for (i in this.transitions)
			{
				if (typeof this.transitions[i] == "number")
				{
					this.transitions[i] = { duration: this.transitions[i] };
				}
			}
			
			// live animators
			this._animators = {}; // keyAnimated => object describing it.
			this._animatableSetCSS = "";
			this._last_transition_css = ""; // to keep from re-setting unnecessarily
		},
		
		/**
			Adds support for some style properties to adjust.
			
			These added properties are currently:
			- opacity.
			- display.
			
			This is a complete rewrite of adjust. Its performance can probably be boosted. Do it!
		*/
		adjust: function(dictionary, value)
		{
			if (!SC.none(value)) {
				var key = dictionary;
				dictionary = { };
				dictionary[key] = value;
			}
			else {
				dictionary = SC.clone(dictionary);
			}
			
			var style = SC.clone(this.get("style")), didChangeStyle = NO, layout = SC.clone(this.get("layout")), didChangeLayout = NO;
			var sprops = this._styleProperties;
			for (var i in dictionary)
			{
				var didChange = NO;
				
				var current = (sprops.indexOf(i) >= 0) ? style : layout;
				var cval = current[i], nval = dictionary[i];
				
				if (nval !== undefined && cval !== nval)
				{
					if (nval === null)
					{
						if (cval !== undefined) didChange = YES;
						delete current[i];
					}
					else
					{
						current[i] = nval;
						didChange = YES;
					}
				}
				
				if (didChange) {
					if (current === style) didChangeStyle = YES; else didChangeLayout = YES;
				}
			}
			
			if (didChangeStyle) this.set("style", style);
			if (didChangeLayout) this.set("layout", layout);
			
			// call base with whatever is leftover
			return this;
		},
		
		/**
			Resets animation so that next manipulation of style will not animate.
			
			Currently does not stop existing animations, so won't work very well
			if there are any (will actually stutter).
		*/
		resetAnimation: function()
		{
			this._animatableCurrentStyle = this.style;
			this.styleDidChange();
		},
		
		_getStartStyleHash: function(start, target)
		{
			// temporarily set layout to "start", in the fastest way possible;
			// note that start is an entire style structure—get("frame") doesn't care! HAH!
			var original_layout = this.layout;
			this.layout = start;
			
			// get our frame and parent's frame
			var f = this.get("frame");
			var p = this.getPath("layoutView.frame");
			
			// set back to target
			this.layout = original_layout;
			
			// prepare a new style set, empty.
			var l = {};
			
			// loop through properties in target
			for (var i in target)
			{
				if (f)
				{
					if (i == "left") { l[i] = f.x; continue; }
					else if (i == " top") { l[i] = f.y; continue; }
					else if (i == "right") { l[i] = p.width - f.x - f.width; continue; }
					else if (i == "bottom") { l[i] = p.height - f.y - f.height; continue; }
					else if (i == "width") { l[i] = f.width; continue; }
					else if (i == "height") { l[i] = f.height; continue; }
					else if (i == "centerX") { l[i] = f.x + (f.width / 2) - (p.width / 2); continue; }
					else if (i == "centerY") { l[i] = f.y + (f.height / 2) - (p.height / 2); continue; }
				}
				
				if (!SC.none(start[i])) l[i] = start[i];
				else l[i] = target[i];
			}
			
			// clean up duplicates (don't move what hasn't moved)
			for (i in l)
			{
				if (l[i] == start[i]) delete l[i];
			}
			
			return l;
		},
		
		_TMP_CSS_TRANSITIONS: [],
		/**
			Triggered when style changes.
		*/
		styleDidChange: function()
		{
			
			// get the layer. We need it for a great many things.
			var layer = this.get("layer");
			
			// cont. with other stuff
			var newStyle = this.get("style");
			
			// make sure there _is_ a previous style to animate from. Otherwise,
			// we don't animate—and this is sometimes used to temporarily disable animation.
			var i;
			if (!this._animatableCurrentStyle)
			{
				// clone it to be a nice starting point next time.
				this._animatableCurrentStyle = {};
				for (i in newStyle)
				{
					if (i[0] != "_") this._animatableCurrentStyle[i] = newStyle[i];
				}
				
				if (layer) this._animatableApplyStyles(layer, newStyle);
				return this;
			}
			
			// no use doing anything else if no layer.
			if (!layer) return;
			
			// compare new style to old style. Manually, to skip guid stuff that can
			// mess things up a bit.
			var equal = true;
			for (i in newStyle)
			{
				if (i[0] == "_") continue;
				if (newStyle[i] != this._animatableCurrentStyle[i])
				{
					equal = false;
					break;
				}
			}
			if (equal) return this;
			
			// get a normalized starting point based off of our style
			var startingPoint = this._getStartStyleHash(this._animatableCurrentStyle, newStyle);
			
			// also prepare an array of CSS transitions to set up.
			var cssTransitions = this._TMP_CSS_TRANSITIONS;
			
			for (i in newStyle)
			{
				if (i[0] == "_") return; // guid (or something else we can't deal with anyway)
				
				// if it needs to be set right away since it is not animatable, _getStartStyleHash
				// will have done that. But if we aren't supposed to animate it, we need to know, now.
				var shouldSetImmediately = !this.transitions[i] || newStyle[i] == startingPoint[i];
				if (i == "display" && newStyle[i] != "none") shouldSetImmediately = true;
				
				if (shouldSetImmediately)
				{
					// set
					startingPoint[i] = newStyle[i];
					
					// you can't easily stop the animator. So just set its endpoint and make it end soon.
					var animator = this._animators[i];
					if (animator)
					{
						animator.endValue = newStyle[i];
						animator.end = 0;
					}
					continue;
				}
				
				// If there is an available CSS transition, use that.
				if (Animate.enableCSSTransitions && this._cssTransitionFor[i])
				{
					cssTransitions.push(this._cssTransitionFor[i] + " " + this.transitions[i].duration + "s linear");
					
					// we can just set it as part of the starting point
					startingPoint[i] = newStyle[i];
					continue;
				}
				
				// well well well... looks like we need to animate. Prepare an animation structure.
				// (WHY ARE WE ALWAYS PREPARING?)
				var applier = this._animateTickPixel, 
					property = i, 
					startValue = startingPoint[i], 
					endValue = newStyle[i];
				
				// special property stuff
				if (property == "centerX" || property == "centerY")
				{
					// uh... need a special applier; it needs to update currentlayout differently than actual
					// layout, since one gets "layout," and the other gets styles.
					applier = this._animateTickCenter;
				}
				else if (property == "opacity")
				{
					applier = this._animateTickNumber;
				}
				else if (property == "display")
				{
					applier = this._animateTickDisplay;
				}
				
				// cache animator objects, not for memory, but so we can modify them.
				if (!this._animators[i]) this._animators[i] = {};
				
				// used to mixin a struct. But I think that would create a new struct.
				// also, why waste cycles on a SC.mixin()? So I go the direct approach.
				var a = this._animators[i];
				
				// set settings...
				// start: Date.now(), // you could put this here. But it is better to wait. The animation is smoother
				// if its beginning time is whenever the first frame fires.
				// otherwise, if there is a big delay before the first frame (perhaps we are animating other elements)
				// the items will "jump" unattractively
				a.start = null;
				a.duration = Math.floor(this.transitions[i].duration * 1000);
				a.startValue = startValue;
				a.endValue = endValue;
				a.layer = layer;
				a.property = property;
				a.action = applier;
				a.style = layer.style;
				a.holder = this;
				
				// add timer
				if (!a.going) this._animationsToStart[i] = a;
			}
			
			// start animations, in order
			var ao = this._animationOrder, l = this._animationOrder.length;
			for (i = 0; i < l; i++)
			{
				var nextAnimation = ao[i];
				if (this._animationsToStart[nextAnimation])
				{
					Animate.addTimer(this._animationsToStart[nextAnimation]);
					delete this._animationsToStart[nextAnimation];
				}
			}
			
			// and update layout to the normalized start.
			var css = cssTransitions.join(",");
			cssTransitions.length = "";
			this._animatableSetCSS = css;
			
			// apply starting styles directly to layer
			this._animatableApplyStyles(layer, startingPoint);

			// all our timers are scheduled, we should be good to go. YAY.
			return this;
			
		}.observes("style"),
		
		_style_opacity_helper: function(style, key, props)
		{
			style["opacity"] = props["opacity"];
			style["mozOpacity"] = props["opacity"]; // older Firefox?
			style["filter"] = "alpha(opacity=" + props["opacity"] * 100 + ")";
		},
		
		_style_display_helper: function(style, key, props)
		{
			style["display"] = props["display"];
		},
		
		_animatableApplyStyles: function(layer, styles)
		{
			var styleHelpers = {
				opacity: this._style_opacity_helper,
				display: this._style_display_helper
				// more to be added here...
			};
			
			// init props
			var newLayout = {}, updateLayout = NO, style = layer.style;
			
			// set CSS transitions very first thing
			if (this._animatableSetCSS != this._last_transition_css) {
				style["-webkit-transition"] = this._animatableSetCSS;
				style["-moz-transition"] = this._animatableSetCSS;
				this._last_transition_css = this._animatableSetCSS;
			}
			
			// we extract the layout portion so SproutCore can do its own thing...
			for (var i in styles)
			{
				if (this._layoutStyles.indexOf(i) >= 0)
				{
					newLayout[i] = styles[i];
					updateLayout = YES;
					continue;
				}
				
				if (styleHelpers[i]) styleHelpers[i](style, i, styles);
			}
			
			// don't want to set because we don't want updateLayout... again.
			if (updateLayout) {
				var prev = this.layout;
				this.layout = newLayout;
			
				// set layout
				this.notifyPropertyChange("layoutStyle");
 
				// apply the styles (but we have to mix it in, because we still have transitions, etc. that we set)
				var ls = this.get("layoutStyle");
				for (var key in ls) {
					if (SC.none(ls[key])) delete style[key];
					else style[key] = ls[key];
				}
				SC.mixin(style, this.get("layoutStyle"));
				
				// go back to previous
				this.layout = prev;
			}
			
			this._animatableCurrentStyle = styles;
		},
		
		/**
			Overridden so that the proper styles are always set after a call to render.
		*/
		_animatable_did_update_layer: function()
		{
			this._animatable_original_did_update_layer();
			var styles = this._animatableCurrentStyle || (this.get("style") || {}), layer = this.get("layer");
			this._animatableApplyStyles(layer, styles);
		},
		
		/**
		Overriden to support animation.
		
		Works by keeping a copy of the current layout, called animatableCurrentLayout.
		Whenever the layout needs updating, the old layout is consulted.
		
		"layout" is kept at the new layout
		*/
		updateLayout: function(context, firstTime)
		{
			var style = SC.clone(this.get("style"));
			var newLayout = this.get("layout");
			var i = 0, ls = this._layoutStyles, lsl = ls.length, didChange = NO;
			for (i = 0; i < lsl; i++)
			{
				var key = ls[i];
				if (style[key] !== newLayout[key])
				{
					if (SC.none(newLayout[key])) delete style[key];
					else style[key] = newLayout[key];
					didChange = YES;
				}
			}
			
			if (didChange) {
				this.style = style;
				this.styleDidChange(); // updateLayout is already called late, so why delay longer?
			}
			
			return this;
		},
		
		/**
			Manages a single step in a single animation.
			NOTE: this=>an animator hash
		*/
		_animateTickPixel: function(t)
		{
			// prepare timing stuff
			// first, setup this.start if needed (it is lazy, after all)
			if (SC.none(this.start))
			{
				this.start = t;
				this.end = this.start + this.duration;
			}
			
			// the differences
			var s = this.start, e = this.end;
			var sv = this.startValue, ev = this.endValue;
			var d = e - s;
			var dv = ev - sv;

			// get current percent of animation completed
			var c = t - s;
			var percent = Math.min(c / d, 1);
			
			// call interpolator (if any)
			if (this.interpolator) percent = this.interpolator(percent);
			
			// calculate new position			
			var value = Math.floor(sv + (dv * percent));
			this.holder._animatableCurrentStyle[this.property] = value;
			
			// note: the following tested faster than directly setting this.layer.style.cssText
			this.style[this.property] = value + "px";
			
			if (t < e) Animate.addTimer(this);
			else this.going = false;
		},
		
		_animateTickDisplay: function(t)
		{
			// prepare timing stuff
			// first, setup this.start if needed (it is lazy, after all)
			if (SC.none(this.start))
			{
				this.start = t;
				this.end = this.start + this.duration;
			}
			
			// check if we should keep going (we only set display none, and only at end)
			var e = this.end;
			if (t < e) 
			{
				Animate.addTimer(this);
				return;
			}
			
			this.holder._animatableCurrentStyle[this.property] = this.endValue;
			this.style[this.property] = this.endValue;
			
			this.going = false;
		},
		
		/**
			Manages a single step in a single animation.
			NOTE: this=>an animator hash
		*/
		_animateTickNumber: function(t)
		{
			// prepare timing stuff
			// first, setup this.start if needed (it is lazy, after all)
			if (SC.none(this.start))
			{
				this.start = t;
				this.end = this.start + this.duration;
			}
			
			// the differences
			var s = this.start, e = this.end;
			var sv = this.startValue, ev = this.endValue;
			var d = e - s;
			var dv = ev - sv;

			// get current percent of animation completed
			var c = t - s;
			var percent = Math.min(c / d, 1);
			
			// call interpolator (if any)
			if (this.interpolator) percent = this.interpolator(percent);
			
			// calculate new position			
			var value = Math.round((sv + (dv * percent)) * 100) / 100;
			this.holder._animatableCurrentStyle[this.property] = value;
			
			// note: the following tested faster than directly setting this.layer.style.cssText
			this.style[this.property] = value;
			if (this.property == "opacity")
			{
				this.style["zoom"] = 1;
				this.style["filter"] = "alpha(opacity=" + Math.round(value * 20) * 5 + ")";
			}
			
			if (t < e) Animate.addTimer(this);
			else this.going = false;
		},
		
		// NOTE: I tested this with two separate functions (one for each X and Y)
		// 		 no definite performance difference on Safari, at least.
		_animateTickCenter: function(t)
		{
			// prepare timing stuff
			// first, setup this.start if needed (it is lazy, after all)
			if (SC.none(this.start))
			{
				this.start = t;
				this.end = this.start + this.duration;
			}
			
			// the differences
			var s = this.start, e = this.end;
			var sv = this.startValue, ev = this.endValue;
			var d = e - s;
			var dv = ev - sv;

			// get current percent of animation completed
			var c = t - s;
			var percent = Math.min(c / d, 1);
			
			// call interpolator (if any)
			if (this.interpolator) percent = this.interpolator(percent);
			
			// calculate new position			
			var value = sv + (dv * percent);
			this.holder._animatableCurrentStyle[this.property] = value;
			
			// calculate style, which needs to subtract half of width/height
			var widthOrHeight, style;
			if (this.property == "centerX")
			{
				widthOrHeight = "width"; style = "margin-left";
			}
			else
			{
				widthOrHeight = "height"; style = "margin-top";
			}
			
			this.style[style] = Math.round(value - (this.holder._animatableCurrentStyle[widthOrHeight] / 2)) + "px";
			
			if (t < e) Animate.addTimer(this);
			else this.going = false;
		}
	}

});

/*
	Test for CSS transition capability...
*/
(function(){
	var test = function(){ //return false;
		// a test element
		var el = document.createElement("div");

		// the css and javascript to test
		var css_browsers = ["-webkit"];
		var test_browsers = ["moz", "Moz", "o", "ms", "webkit"];

		// prepare css
		var css = "", i = null;
		for (i = 0; i < css_browsers.length; i++) css += css_browsers[i] + "-transition:all 1s linear;"

		// set css text
		el.style.cssText = css;

		// test
		for (i = 0; i < test_browsers.length; i++)
		{
			if (el.style[test_browsers[i] + "TransitionProperty"] !== undefined) return true;	
		}
		
		return false;
	};
	
	// test
	var testResult = test();
	// console.error("Supports CSS transitions: " + testResult);
	
	// and apply what we found
	if (testResult) Animate.enableCSSTransitions = true;
})();