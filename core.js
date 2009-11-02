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
		- No support for changing non-layout properties such as color.
		
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
	currentTime: (new Date()).getTime(),
	
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
		Animate._timer_start_time = (new Date()).getTime();
		Animate.going = true;
		
		// set a timeout so tick only runs AFTER any pending animation timers are set.
		setTimeout(Animate.timeout, 0);
	},
	
	timeout: function()
	{	
		Animate.currentTime = (new Date()).getTime();
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
		var end = (new Date()).getTime();
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
		_styleProperties: [ "opacity" ],
		_layoutStyles: ["left", "right", "top", "bottom", "width", "height", "centerX", "centerY"],
		
		// we cache this dictionary so we don't generate a new one each time we make
		// a new animation. It is used so we can start the animations in order—
		// for instance, centerX and centerY need to be animated _after_ width and height.
		_animationsToStart: {},
		
		// and, said animation order
		_animationOrder: ["top", "left", "bottom", "right", "width", "height", "centerX", "centerY", "opacity"],
		
		
		initMixin: function()
		{
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
			this._animatableSetCSS = {};
		},
		
		/**
			Adds support for some style properties to adjust.
			
			These added properties are currently:
			- opacity.
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
			
			var style = SC.clone(this.get("style")), didChange = NO;
			var sprops = this._styleProperties;
			for (var i in dictionary)
			{
				if (sprops.indexOf(i) >= 0)
				{
					style[i] = dictionary[i];
					delete dictionary[i];
					didChange = YES;
				}
			}
			
			if (didChange) this.set("style", style);
			
			// call base with whatever is leftover
			return arguments.callee.base.call(this, dictionary, value);
		},
		
		/**
			Resets animation so that next manipulation of style will not animate.
			
			Currently does not stop existing animations, so won't work very well
			if there are any (will actually stutter).
		*/
		resetAnimation: function()
		{
			this._animatableCurrentStyle = null;
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
				switch(i)
				{
					case "left":
						l[i] = f.x; break;
					case "top":
						l[i] = f.y; break;
					case "right":
						l[i] = p.width - f.x - f.width; break;
					case "bottom":
						l[i] = p.height - f.y - f.height; break;
					case "height":
						l[i] = f.height; break;
					case "width":
						l[i] = f.width; break;
					case "centerX":
						l[i] = f.x + (f.width / 2) - (p.width / 2); break;
					case "centerY":
						l[i] = f.y + (f.height / 2) - (p.height / 2); break;
					
					// don't need to interpet any others, so just do directly
					default:
						if (!SC.none(start[i])) l[i] = start[i];
						else l[i] = target[i];
				}
			}
			
			return l;
		},
		
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
				sc_super();
				
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
			var cssTransitions = [];
			
			for (i in newStyle)
			{
				if (i[0] == "_") return; // guid (or something else we can't deal with anyway)
				
				// if it needs to be set right away since it is not animatable, _getStartStyleHash
				// will have done that. But if we aren't supposed to animate it, we need to know, now.
				if (!this.transitions[i] || newStyle[i] == startingPoint[i])
				{
					startingPoint[i] = newStyle[i];
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
			this._animatableSetCSS = css;
			
			// apply starting styles directly to layer
			this._animatableApplyStyles(layer, startingPoint);

			// all our timers are scheduled, we should be good to go. YAY.
			return this;
			
		}.observes("style"),
		
		_style_opacity_helper: function(style, key, props)
		{
			style["opacity"] = props["opacity"];
			style["-moz-opacity"] = props["-moz-opacity"]; // older Firefox?
			// todo: filter garbage.
		},
		
		_animatableApplyStyles: function(layer, styles)
		{
			var styleHelpers = {
				opacity: this._style_opacity_helper
				// more to be added here...
			};
			
			// we extract the layout portion so SproutCore can do its own thing...
			var newLayout = {};
			var style = layer.style;
			for (var i in styles)
			{
				if (this._layoutStyles.indexOf(i) >= 0)
				{
					newLayout[i] = styles[i];
					continue;
				}
				
				if (styleHelpers[i]) styleHelpers[i](style, i, styles);
			}
			
			// don't want to set because we don't want updateLayout... again.
			var prev = this.layout;
			this.layout = newLayout;
			
			// set layout
			this.notifyPropertyChange("layoutStyle");
 
			// notify of update
			var context = this.renderContext(layer);
			this.renderLayout(context);
			context.addStyle("-webkit-transition", this._animatableSetCSS);
			context.addStyle("-moz-transition", this._animatableSetCSS);
			context.update();
			
			// go back to previous
			this.layout = prev;
			this._animatableCurrentStyle = styles;
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
			if (t.interpolator) percent = t.interpolator(percent);
			
			// calculate new position			
			var value = Math.floor(sv + (dv * percent));
			this.holder._animatableCurrentStyle[this.property] = value; //this.layout => the real this._animatableCurrentLayout
			
			// note: the following tested faster than directly setting this.layer.style.cssText
			this.style[this.property] = value + "px";
			
			if (t < e) Animate.addTimer(this);
			else this.going = false;
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
			if (t.interpolator) percent = t.interpolator(percent);
			
			// calculate new position			
			var value = Math.round((sv + (dv * percent)) * 100) / 100;
			this.holder._animatableCurrentStyle[this.property] = value; //this.layout => the real this._animatableCurrentLayout
			
			// note: the following tested faster than directly setting this.layer.style.cssText
			this.style[this.property] = value;
			
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
			if (t.interpolator) percent = t.interpolator(percent);
			
			// calculate new position			
			var value = sv + (dv * percent);
			this.holder._animatableCurrentStyle[this.property] = value; //this.layout => the real this._animatableCurrentLayout
			
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