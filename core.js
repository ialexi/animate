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
		
	Example Usage:
	{{{
		aView: SC.LabelView.design(Animate.Animatable, {
			transitionLayout: {
				left: {duration: 250},
				top: {duration: 250}
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
		if (!Animate.going)
			Animate.start();
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
		var start = Animate.currentTime = (new Date()).getTime();
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
		if (Animate._ticks < 1000000) // okay, put _some_ limit on it
			Animate._ticks++;
		
		// now see about doing next bit...	
		var end = (new Date()).getTime();
		var elapsed = end - start;
		if (Animate.baseTimer.next)
			setTimeout(function(){ Animate.timeout(); }, Math.max(0, Animate.interval - elapsed));
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
		transitionLayout: {},
		concatenatedProperties: ["transitionLayout"],
		
		// collections of CSS transitions we have available
		_cssTransitionFor: {
			"left": "left", "top": "top", 
			"right": "right", "bottom": "bottom",
			"width": "width", "height": "height"
		},
		
		// we cache this dictionary so we don't generate a new one each time we make
		// a new animation. It is used so we can start the animations in order—
		// for instance, centerX and centerY need to be animated _after_ width and height.
		_animationsToStart: {},
		
		// and, said animation order
		_animationOrder: ["top", "left", "bottom", "right", "width", "height", "centerX", "centerY"],
		
		
		initMixin: function()
		{
			this._animateTickPixel.displayName = "animate-tick";
			// if transitionLayout was concatenated...
			if (SC.isArray(this.transitionLayout))
			{
				var tl = {}; // prepare a new one mixed in
				for (var i = 0; i < this.transitionLayout.length; i++)
				{
					SC.mixin(tl, this.transitionLayout[i]);
				}
				this.transitionLayout = tl;
			}
			
			// live animators
			this._animators = {}; // keyAnimated => object describing it.
			this._animatableSetCSS = {};
		},
		
		/**
			Returns a starting hash based on the previous layout (start), but
			put in terms of the new (current) layout.
			
			NOTE: will temporarily change this.layout to start.
		*/
		_animatableStartLayoutHash: function(start)
		{
			// temporarily set layout to "start", in the fastest way possible:
			var target = this.layout;
			this.layout = start;
			
			// get our frame and parent's frame
			var f = this.get("frame");
			var p = this.getPath("parentView.frame");
			
			// set back to target
			this.layout = target;
			
			// prepare a new layout, empty.
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
					
					// cannot animate any others... so just set to target.
					default:
						l[i] = target[i];
				}
			}
			
			return l;
		},
		
		/**
		Overriden to support animation.
		
		Works by keeping a copy of the current layout, called animatableCurrentLayout.
		Whenever the layout needs updating, the old layout is consulted.
		
		"layout" is kept at the new layout
		*/
		updateLayout: function(context, firstTime)
		{
			var newLayout = this.get("layout");
			
			// make sure we have a current layout, otherwise... nothing to animate!
			// also, if animation is disabled...
			if (!this._animatableCurrentLayout || firstTime)
			{
				sc_super();
				
				// clone manually so we don't catch our death of guid
				this._animatableCurrentLayout = {};
				for (var i in newLayout)
					if (i[0] != "_")
						this._animatableCurrentLayout[i] = newLayout[i];
				
				return;
			}
			
			var layer = this.get("layer");
			if (!layer)
				return;
			
			// don't animate if there is nothing to animate. Compare manually; isEqual
			// uses the guid if possible, which is not necessarily accurate, because
			// clone clones that (and adjust uses clone)
			var equal = true;
			for (var i in newLayout)
			{
				if (i[0] == "_") continue;
				if (newLayout[i] != this._animatableCurrentLayout[i])
				{
					equal = false;
					break;
				}
			}
			if (equal)
				return;
			
			// get normalized start
			var normalizedStart = this._animatableStartLayoutHash(this._animatableCurrentLayout);
			var cssTransitions = [];
			for (var i in newLayout)
			{
				if (i[0] == "_") // guid (or something else we can't deal with anyway)
					return;
				
				// if it needs to be set right away since it is not animatable, _animatableStartHash
				// will have done that. But if we aren't supposed to animate it, we need to know, now.
				if (!this.transitionLayout[i] || newLayout[i] == normalizedStart[i])
				{
					normalizedStart[i] = newLayout[i];
					continue;
				}
				
				// If there is an available CSS transition, use that.
				if (Animate.enableCSSTransitions && this._cssTransitionFor[i])
				{
					cssTransitions.push(this._cssTransitionFor[i] + " " + (this.transitionLayout[i].duration / 1000) + "s linear");
					normalizedStart[i] = newLayout[i];
					continue;
				}
				
				// well well well... looks like we need to animate. Prepare an animation structure.
				// (WHY ARE WE ALWAYS PREPARING?)
				var applier = this._animateTickPixel, property = i, startValue = normalizedStart[i], endValue = newLayout[i];
				
				// special property stuff
				if (property == "centerX" || property == "centerY")
				{
					// uh... need a special applier; it needs to update currentlayout differently than actual
					// layout, since one gets "layout," and the other gets styles.
					applier = this._animateTickCenter;
				}
				
				// cache animator objects, not for memory, but so we can modify them.
				if (!this._animators[i])
					this._animators[i] = {};
				
				// used to mixin a struct. But I think that would create a new struct.
				// also, why waste cycles on a SC.mixin()? So I go the direct approach.
				var a = this._animators[i];
				
				// set settings...
				// start: Date.now(), // you could put this here. But it is better to wait. The animation is smoother
				// if its beginning time is whenever the first frame fires.
				// otherwise, if there is a big delay before the first frame (perhaps we are animating other elements)
				// the items will "jump" unattractively
				a.start = null;
				a.duration = this.transitionLayout[i].duration;
				a.startValue = startValue, a.endValue = endValue;
				a.layer = layer;
				a.property = property;
				a.action = applier;
				a.style = layer.style;
				a.holder = this;
				
				// add timer
				if (!a.going)
					this._animationsToStart[i] = a;
			}
			
			// start animations, in order
			var ao = this._animationOrder, l = this._animationOrder.length;
			for (var i = 0; i < l; i++)
			{
				var a = ao[i];
				if (this._animationsToStart[a])
				{
					Animate.addTimer(this._animationsToStart[a]);
					delete this._animationsToStart[a];
				}
			}
			
			// and update layout to the normalized start.
			var css = cssTransitions.join(",");
			this._animatableSetCSS = css;
			
			this._animatableLayoutUpdate(normalizedStart);
			this._animatableCurrentLayout = normalizedStart;

			// all our timers are scheduled, we should be good to go. YAY.
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
			this.holder._animatableCurrentLayout[this.property] = value; //this.layout => the real this._animatableCurrentLayout
			
			// note: the following tested faster than directly setting this.layer.style.cssText
			this.style[this.property] = value + "px";
			
			if (t < e)
				Animate.addTimer(this);
			else
				this.going = false;
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
			this.holder._animatableCurrentLayout[this.property] = value; //this.layout => the real this._animatableCurrentLayout
			
			// calculate style, which needs to subtract half of width/height
			var widthOrHeight, style;
			if (this.property == "centerX")
				widthOrHeight = "width", style = "margin-left";
			else widthOrHeight = "height", style = "margin-top";
			
			this.style[style] = Math.round(value - (this.holder._animatableCurrentLayout[widthOrHeight] / 2)) + "px";
			
			if (t < e)
				Animate.addTimer(this);
			else
				this.going = false;
		},
		
		/**
			Triggers a layout re-rendering with specified layout. Does not change layout.
			TODO: override renderLayout so that it can take a layout parameter for us, so
			we don't keep changing layout like this.
		*/
		_animatableLayoutUpdate: function(layout)
		{
			var prev = this.layout;
			this.layout = layout;
			
			// set layout
			this.notifyPropertyChange("layoutStyle");
 
			// notify of update
			var layer = this.get("layer");
			if (layer) {
				var context = this.renderContext(layer);
				this.renderLayout(context);
				context.addStyle("-webkit-transition", this._animatableSetCSS);
				context.addStyle("-moz-transition", this._animatableSetCSS);
				context.update();
			}
			
			this.layout = prev;
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
		var css = "";
		for (var i = 0; i < css_browsers.length; i++)
			css += css_browsers[i] + "-transition:all 1s linear;"

		// set css text
		el.style.cssText = css;

		// test
		for (var i = 0; i < test_browsers.length; i++)
		{
			if (el.style[test_browsers[i] + "TransitionProperty"] !== undefined)
				return true;	
		}
		
		return false;
	}
	
	// test
	var testResult = test();
	// console.error("Supports CSS transitions: " + testResult);
	
	// and apply what we found
	if (testResult)
		Animate.enableCSSTransitions = true;
})();