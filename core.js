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
	addTimer: function(animator)
	{
		animator.next = Animate.baseTimer.next;
		Animate.baseTimer.next = animator;
		if (!Animate.going)
			Animate.timeout();
	},
	
	timeout: function()
	{
		var start = Date.now();
		Animate.going = true;
		var next = Animate.baseTimer.next;
		Animate.baseTimer.next = null;
		while (next)
		{
			var t = next.next;
			next.action.call(next);
			next = t;
		}
		
		var elapsed = Date.now() - start;
		if (Animate.baseTimer.next)
			setTimeout(function(){ Animate.timeout(); }, Math.max(0, Animate.interval - elapsed));
		else
			Animate.going = false;
	},
	
	
	Animatable: {
		transitionLayout: {},
		concatenatedProperties: ["transitionLayout"],
		
		_animatableCSSTransitions: false,
		_cssTransitionFor: {
			"left": "left", "top": "top", "right": "right", "bottom": "bottom",
			"width": "width", "height": "height"
		},
		
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
				this._animatableCurrentLayout = newLayout;
				return;
			}
			
			// don't animate if there is nothing to animate.
			if (SC.isEqual(newLayout, this._animatableCurrentLayout))
				return;
			
			// get normalized start
			var normalizedStart = this._animatableStartLayoutHash(this._animatableCurrentLayout);
			var cssTransitions = [];
			var layer = this.get("layer");
			
			for (var i in newLayout)
			{
				// stop any old animations
				if (this._animators[i])
				{
					this._animators[i].invalidate();
					this._animators[i].destroy();
					delete this._animators[i];
				}
				
				// if it needs to be set right away since it is not animatable, _animatableStartHash
				// will have done that. But if we aren't supposed to animate it, we need to know, now.
				if (!this.transitionLayout[i] || newLayout[i] == normalizedStart[i])
				{
					normalizedStart[i] = newLayout[i];
					continue;
				}
				
				// If there is an available CSS transition, use that.
				if (this._animatableCSSTransitions && this._cssTransitionFor[i])
				{
					cssTransitions.push(this._cssTransitionFor[i] + " " + (this.transitionLayout[i].duration / 1000) + "s linear");
					normalizedStart[i] = newLayout[i];
					continue;
				}
				
				// well well well... looks like we need to animate. Prepare an animation structure.
				// (WHY ARE WE ALWAYS PREPARING?)
				var animator = {
					start: Date.now(),
					end: Date.now() + this.transitionLayout[i].duration,
					startValue: normalizedStart[i],
					endValue: newLayout[i],
					timer: undefined,
					property: i,
					layer: layer,
					action: this._animateTickPixel,
					layout: this._animatableCurrentLayout
				};
				
				// add timer
				Animate.addTimer(animator);
				continue;
				
				this._animators[i] = SC.Timer.schedule({
					target: animator,
					action: this._animateTickPixel,
					interval: 10,
					repeats: YES,
					until: animator.end
				});
			}
			this._animatableLayoutUpdate(normalizedStart);
			
			
			// and update layout to the normalized start.
			var css = cssTransitions.join(",");
			this._animatableSetCSS = css;

			// all our timers are scheduled, we should be good to go. YAY.
			return this;
		},
		
		/**
			Manages a single step in a single animation.
			NOTE: this=>an animator hash
		*/
		_animateTickPixel: function()
		{
			// prepare timing stuff
			var s = this.start, e = this.end;
			var sv = this.startValue, ev = this.endValue;
			var d = e - s;
			var dv = ev - sv;

			// get current
			var t = Date.now();
			var c = t - s;
			var percent = Math.min(c / d, 1);
			
			// todo: call interpolation function, if any, here
			
			// calculate new position			
			// WAY 1: Modify style directly
			var value = sv + (dv * percent);
			this.layout[this.property] = value; //this.layout => the real this._animatableCurrentLayout
			this.layer.style[this.property] = value + "px";
			
			if (t < this.end)
				Animate.addTimer(this);
		},
		
		_animateTickCenterX: function(a)
		{
			
		},
		
		_animateTickCenterY: function(a)
		{
			
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
	var test = function(){ return false;
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
		Animate.Animatable._animatableCSSTransitions = true;
})();