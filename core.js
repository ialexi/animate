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
			Returns a starting hash with all terms in the target
			layout defined, for use in interpolation.
		*/
		_animatableStartLayoutHash: function(target)
		{
			// get our frame and parent's frame
			var f = this.get("frame");
			var p = this.getPath("parentView.frame");
			
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
		Whenever layout is changed, the new value is stored in "target", the "layout"
		property is reset to the animatableCurrentLayout, and animatable properties
		interpolate between the (original) animatableCurrentLayout and "target".
		
		Note that this interpolation updates animatableCurrentLayout; the start values
		for any interpolations are actually stored in the animator hash.
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
			
			// reset layout
			this.set("layout", this._animatableCurrentLayout);
			
			// get normalized start
			var normalizedStart = this._animatableStartLayoutHash(newLayout);
			var cssTransitions = [];
			// stop any old animations
			for (var i in newLayout)
			{
				if (this._animators[i])
				{
					this._animators[i].timer.invalidate();
					this._animators[i].timer.destroy();
				}
				
				// if it needs to be set right away since it is not animatable, it will
				// have been. But if we choose not to animate it... that's a different story.
				// just add it to normalized start so it will be set immediately.
				if (!this.transitionLayout[i] || newLayout[i] == normalizedStart[i])
				{
					normalizedStart[i] = newLayout[i];
					continue;
				}
				
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
					property: i
				};
				
				animator.timer = SC.Timer.schedule({
					target: this,
					action: function(animator) {
						return function(){ this._animatableAnimationStep(animator); };
					}(animator),
					interval: 10,
					repeats: YES,
					until: animator.end
				});
			}
			
			// and update layout to the normalized start.
			var css = cssTransitions.join(",");
			this._animatableSetCSS = css;
			
			this.set("layout", normalizedStart);
			
			this._animatableLayoutUpdate();

			// all our timers are scheduled, we should be good to go. YAY.
			return this;
		},
		
		/**
			Manages a single step in a single animation.
		*/
		_animatableAnimationStep: function(a)
		{
			// prepare timing stuff
			var s = a.start, e = a.end;
			var d = e - s;

			// get current
			var c = Date.now() - s;
			var percent = c / d;

			// Now, interpolate between start layout and end layout
			var value = a.startValue + ((a.endValue - a.startValue) * percent);
			this.layout[a.property] = value;
			
			// trigger update
			this._animatableLayoutUpdate();

			// update current layout
			this._animatableCurrentLayout = this.layout;
		},
		
		/**
			Triggers a layout re-rendering.
		*/
		_animatableLayoutUpdate: function()
		{
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
		}
	}

});

/*
	Test for CSS transition capability...
*/
(function(){
	var test = function(){
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