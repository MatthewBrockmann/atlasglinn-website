/* ======================================================= 
 * Auto Grid Responsive Gallery
 * By David Blanco
 *
 * Contact: http://codecanyon.net/user/davidbo90
 *
 * Created: June 6, 2013
 *
 * Copyright (c) 2013, David Blanco. All rights reserved.
 * Released under CodeCanyon License http://codecanyon.net/
 *
 * Note: Script based in jQuery Masonry v2.1.07 made by David DeSandro http://masonry.desandro.com/ (under MIT)
 *
 * ======================================================= */

(function( window, $, undefined ){

  'use strict';

  /*
   * smartresize: debounced resize event for jQuery
   *
   * latest version and complete README available on Github:
   * https://github.com/louisremi/jquery.smartresize.js
   *
   * Copyright 2011 @louis_remi
   * Licensed under the MIT license.
   */

  var $event = $.event,
      dispatchMethod = $.event.handle ? 'handle' : 'dispatch',
      resizeTimeout;

  $event.special.smartresize = {
    setup: function() {
      $(this).bind( "resize", $event.special.smartresize.handler );
    },
    teardown: function() {
      $(this).unbind( "resize", $event.special.smartresize.handler );
    },
    handler: function( event, execAsap ) {
      // Save the context
      var context = this,
          args = arguments;

      // set correct event type
      event.type = "smartresize";

      if ( resizeTimeout ) { clearTimeout( resizeTimeout ); }
      resizeTimeout = setTimeout(function() {
        $event[ dispatchMethod ].apply( context, args );

      }, execAsap === "execAsap"? 0 : 100 );
    }
  };

  $.fn.smartresize = function( fn ) {
    return fn ? this.bind( "smartresize", fn ) : this.trigger( "smartresize", ["execAsap"] );
  };



// ========================= Grid ===============================


  // our "Widget" object constructor
  $.AutoGridMasonry = function( options, element ){
    this.element = $( element );
    this._create( options );
    this._init();
  };

  $.AutoGridMasonry.settings = {
    isResizable: true,
    isAnimated: false,
    animationOptions: {
      queue: false,
      duration: 500,
      //=David Blanco
      complete: function(){// If the plugin doesn't support transformation then load the images when the animation finish
          var $this = $(this);

          if( !$this.hasClass('autoGridGallery-brick') ){//If is the container (not the boxes)

              if($.fn.autoGridGallery.defaults.lazyLoad){//Refresh the waypoint
                  $.waypoints('refresh');
              }

              if( $this.hasClass('autoGridGallery-with-loading-boxes') ){
                  $this.removeClass('autoGridGallery-with-loading-boxes');
                  $this.addClass('completeAddingImages');
              }
          }
      },
      //=End David Blanco
    },
    gutterWidth: 0,
    isRTL: false,
    isFitWidth: false,
    containerStyle: {
      position: 'relative'
    }
  };

  $.AutoGridMasonry.prototype = {
    //=db
    _resized: false,
    //=End db

    _filterFindBricks: function( $elems ) {
      var selector = this.options.itemSelector;
      // if there is a selector
      // filter/find appropriate item elements
      return !selector ? $elems : $elems.filter( selector ).add( $elems.find( selector ) );
    },

    _getBricks: function( $elems ) {
      var $bricks = this._filterFindBricks( $elems )
        .css({ position: 'absolute' })
        .addClass('autoGridGallery-brick');
      return $bricks;
    },
    
    // sets up widget
    _create : function( options ) {
      
      this.options = $.extend( true, {}, $.AutoGridMasonry.settings, options );
      this.styleQueue = [];

      // get original styles in case we re-apply them in .destroy()
      var elemStyle = this.element[0].style;
      this.originalStyle = {
        // get height
        height: elemStyle.height || ''
      };
      // get other styles that will be overwritten
      var containerStyle = this.options.containerStyle;
      for ( var prop in containerStyle ) {
        this.originalStyle[ prop ] = elemStyle[ prop ] || '';
      }

      this.element.css( containerStyle );

      this.horizontalDirection = this.options.isRTL ? 'right' : 'left';

      var x = this.element.css( 'padding-' + this.horizontalDirection );
      var y = this.element.css( 'padding-top' );
      this.offset = {
        x: x ? parseInt( x, 10 ) : 0,
        y: y ? parseInt( y, 10 ) : 0
      };
      
      this.isFluid = this.options.columnWidth && typeof this.options.columnWidth === 'function';

      // add autoGridGallery class first time around
      var instance = this;
      setTimeout( function() {
        instance.element.addClass('autoGridGallery');
      }, 0 );
      
      // bind resize method
      if ( this.options.isResizable ) {
        $(window).bind( 'smartresize.autoGridGallery', function() { 
          instance.resize();
        });
      }


      // need to get bricks
      this.reloadItems();

    },
  
    // _init fires when instance is first created
    // and when instance is triggered again -> $el.autoGridGallery();
    _init : function( callback ) {
      this._getColumns();
      this._reLayout( callback );
    },

    option: function( key, value ){
      // set options AFTER initialization:
      // signature: $('#foo').bar({ cool:false });
      if ( $.isPlainObject( key ) ){
        this.options = $.extend(true, this.options, key);
      } 
    },
    
    // ====================== General Layout ======================

    // used on collection of atoms (should be filtered, and sorted before )
    // accepts atoms-to-be-laid-out to start with
    layout : function( $bricks, callback ) {

      // place each brick
      for (var i=0, len = $bricks.length; i < len; i++) {
        this._placeBrick( $bricks[i] );
      }
      
      // set the size of the container
      var containerSize = {};
      containerSize.height = Math.max.apply( Math, this.colYs );
      if ( this.options.isFitWidth ) {
        var unusedCols = 0;
        i = this.cols;
        // count unused columns
        while ( --i ) {
          if ( this.colYs[i] !== 0 ) {
            break;
          }
          unusedCols++;
        }
        // fit container to columns that have been used;
        containerSize.width = (this.cols - unusedCols) * this.columnWidth - this.options.gutterWidth;
      }
      this.styleQueue.push({ $el: this.element, style: containerSize });

      // are we animating the layout arrangement?
      // use plugin-ish syntax for css or animate
      var styleFn = !this.isLaidOut ? 'css' : (
            this.options.isAnimated ? 'animate' : 'css'
          ),
          animOpts = this.options.animationOptions;

      // process styleQueue
      var obj;
      //=David Blanco
      var loading = false;
      //=End David Blanco
      for (i=0, len = this.styleQueue.length; i < len; i++) {
        obj = this.styleQueue[i];

        //=David Blanco
        styleFn = !this.isLaidOut ? 'css' : ( this.options.isAnimated ? 'animate' : 'css' );

        var loadingBox = obj.$el.hasClass('loading-box');
        if( loadingBox && !this.element.hasClass('noSupportTransform') ){
            styleFn = 'css';
            loading = true;
        }else if(loading){//for the container
            obj.$el[ 'css' ]( obj.style, animOpts );
        }
        obj.$el.removeClass('loading-box');

        var left = obj.$el.css('left');
        var top  = obj.$el.css('top');

        var newLeft = obj.style.left+'px';
        var newTop  = obj.style.top+'px';

        if( ( left==newLeft && top==newTop ) || loadingBox==true){
          //console.log('is not going to move...');
          obj.$el.data('moving', false);
        }else{
          //console.log('is going to move...');
          obj.$el.data('moving', true);
        }

        var durationAnim = 500;

        //=End David Blanco

        obj.$el[ styleFn ]( obj.style, animOpts );
      }

      // clear out queue for next time
      this.styleQueue = [];

      // provide $elems as context for the callback
      if ( callback ) {
        callback.call( $bricks );
      }
      
      this.isLaidOut = true;
    },
    
    // calculates number of columns
    // i.e. this.columnWidth = 200
    _getColumns : function() {
      var container = this.options.isFitWidth ? this.element.parent() : this.element,
          containerWidth = container.width();
                         // use fluid columnWidth function if there
      this.columnWidth = this.isFluid ? this.options.columnWidth( containerWidth ) :
                    // if not, how about the explicitly set option?
                    this.options.columnWidth ||
                    // or use the size of the first item
                    this.$bricks.outerWidth(true) ||
                    // if there's no items, use size of container
                    containerWidth;

      this.columnWidth += this.options.gutterWidth;

      this.cols = Math.floor( ( containerWidth + this.options.gutterWidth ) / this.columnWidth );
      this.cols = Math.max( this.cols, 1 );

    },

    // layout logic
    _placeBrick: function( brick ) {
      var $brick = $(brick),
          colSpan, groupCount, groupY, groupColY, j;

      //how many columns does this brick span
      colSpan = Math.ceil( $brick.outerWidth(true) / this.columnWidth );
      colSpan = Math.min( colSpan, this.cols );

      if ( colSpan === 1 ) {
        // if brick spans only one column, just like singleMode
        groupY = this.colYs;
      } else {
        // brick spans more than one column
        // how many different places could this brick fit horizontally
        groupCount = this.cols + 1 - colSpan;
        groupY = [];

        // for each group potential horizontal position
        for ( j=0; j < groupCount; j++ ) {
          // make an array of colY values for that one group
          groupColY = this.colYs.slice( j, j+colSpan );
          // and get the max value of the array
          groupY[j] = Math.max.apply( Math, groupColY );
        }

      }

      // get the minimum Y value from the columns
      var minimumY = Math.min.apply( Math, groupY ),
          shortCol = 0;
      
      // Find index of short column, the first from the left
      for (var i=0, len = groupY.length; i < len; i++) {
        if ( groupY[i] === minimumY ) {
          shortCol = i;
          break;
        }
      }

      // position the brick
      var position = {
        top: minimumY + this.offset.y
      };
      // position.left or position.right
      position[ this.horizontalDirection ] = this.columnWidth * shortCol + this.offset.x;
      this.styleQueue.push({ $el: $brick, style: position });

      // apply setHeight to necessary columns
      var setHeight = minimumY + $brick.outerHeight(true),
          setSpan = this.cols + 1 - len;
      for ( i=0; i < setSpan; i++ ) {
        this.colYs[ shortCol + i ] = setHeight;
      }

    },
    
    
    resize: function() {
      var prevColCount = this.cols;
      // get updated colCount
      this._getColumns();
      if ( this.isFluid || this.cols !== prevColCount ) {
        // if column count has changed, trigger new layout
        this._reLayout();
      }
    },
    
    
    _reLayout : function( callback ) {
      // reset columns
      var i = this.cols;
      this.colYs = [];
      while (i--) {
        this.colYs.push( 0 );
      }
      // apply layout logic to all bricks
      this.layout( this.$bricks, callback );
    },
    
    // ====================== Convenience methods ======================
    
    // goes through all children again and gets bricks in proper order
    reloadItems : function() {
      this.$bricks = this._getBricks( this.element.children() );
    },
    
    
    reload : function( callback ) {
      this.reloadItems();
      this._init( callback );
    },
    

    // convienence method for working with Infinite Scroll
    appended : function( $content, isAnimatedFromBottom, callback ) {

      if ( isAnimatedFromBottom ) {
        // set new stuff to the bottom
        this._filterFindBricks( $content ).css({ top: this.element.height() });
        var instance = this;
        setTimeout( function(){
          instance._appended( $content, callback );
        }, 1 );
      } else {
        this._appended( $content, callback );
      }
    },
    
    _appended : function( $content, callback ) {
      var $newBricks = this._getBricks( $content );
      // add new bricks to brick pool
      this.$bricks = this.$bricks.add( $newBricks );
      this.layout( $newBricks, callback );
    },
    
    // removes elements from Grid widget
    remove : function( $content ) {
      this.$bricks = this.$bricks.not( $content );
      $content.remove();
    },
    
    // destroys widget, returns elements and container back (close) to original style
    destroy : function() {

      this.$bricks
        .removeClass('autoGridGallery-brick')
        .each(function(){
          this.style.position = '';
          this.style.top = '';
          this.style.left = '';
        });
      
      // re-apply saved container styles
      var elemStyle = this.element[0].style;
      for ( var prop in this.originalStyle ) {
        elemStyle[ prop ] = this.originalStyle[ prop ];
      }

      this.element
        .unbind('.autoGridGallery')
        .removeClass('autoGridGallery')
        .removeData('autoGridGallery');
      
      $(window).unbind('.autoGridGallery');

    }
    
  };
  
  
  // ======================= imagesLoaded Plugin ===============================
  /*!
   * jQuery imagesLoaded plugin v1.1.0
   * http://github.com/desandro/imagesloaded
   *
   * MIT License. by Paul Irish et al.
   */


  // $('#my-container').imagesLoaded(myFunction)
  // or
  // $('img').imagesLoaded(myFunction)

  // execute a callback when all images have loaded.
  // needed because .load() doesn't work on cached images

  // callback function gets image collection as argument
  //  `this` is the container

  $.fn.imagesLoaded = function( callback ) {
    var $this = this,
        $images = $this.find('img').add( $this.filter('img') ),
        len = $images.length,
        blank = '#',
        //blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        loaded = [];

    function triggerCallback() {
      callback.call( $this, $images );
    }

    function imgLoaded( event ) {
      var img = event.target;
      if ( img.src !== blank && $.inArray( img, loaded ) === -1 ){
        loaded.push( img );
        if ( --len <= 0 ){
          setTimeout( triggerCallback );
          $images.unbind( '.imagesLoaded', imgLoaded );
        }
      }
    }

    // if no images, trigger immediately
    if ( !len ) {
      triggerCallback();
    }

    $images.bind( 'load.imagesLoaded error.imagesLoaded',  imgLoaded ).each( function() {
      // cached images don't fire load sometimes, so we reset src.
      var src = this.src;
      // webkit hack from http://groups.google.com/group/jquery-dev/browse_thread/thread/eee6ab7b2da50e1f
      // data uri bypasses webkit log warning (thx doug jones)
      this.src = blank;
      this.src = src;
    });

    return $this;
  };


  // helper function for logging errors
  // $.error breaks jQuery chaining
  var logError = function( message ) {
    if ( window.console ) {
      window.console.error( message );
    }
  };
  
  // =======================  Plugin bridge  ===============================
  // leverages data method to either create or return $.AutoGridMasonry constructor
  // A bit from jQuery UI
  //   https://github.com/jquery/jquery-ui/blob/master/ui/jquery.ui.widget.js
  // A bit from jcarousel 
  //   https://github.com/jsor/jcarousel/blob/master/lib/jquery.jcarousel.js



  $.fn.autoGridGallery = function( options ) {
    //=db

    var db = function($this){
        var ops = $.extend({}, $.fn.autoGridGallery.defaults, options);

        $.fn.autoGridGallery.defaults.lazyLoad = options.lazyLoad;

        if(options == undefined){
          options = {};
        }

        options.isFitWidth = ops.isFitWidth;
        options.isAnimated = ops.isAnimated; 
        options.itemSelector = '.agrg_box';
        options.gutterWidth = ops.horizontalSpaceBetweenThumbnails;
        /* *************************************** ADJUST THE WIDTH OF THE COLUMNS *************************************** */
        var $container = $($this);
        var $op        = ops.columnWidth;

        if($op == 'auto'){
            options.columnWidth = function(containerWidth){
                                      var box_width =  -999; //Just making sure that at least enters once to the condition below
                                      for(var i=ops.columns; i>=1; i--){
                                          if(box_width < ops.columnMinWidth){
                                              box_width = (((containerWidth - (i-1)*options.gutterWidth)/i) | 0);
                                          }
                                      }

                                      //box_width = 280;
                                      $container.find('div.agrg_box').width(box_width);
                                      return box_width;
                                  };

        }else if( (typeof $op)!= 'function' ){
            options.columnWidth = function(containerWidth){
                                      var box_width =  $op;

                                      $container.find('div.agrg_box').width(box_width);
                                      return box_width;
                                  };
        }


        $container.find('div.agrg_box').css('margin-bottom', ops.verticalSpaceBetweenThumbnails);

        var supports = (function() {  
            var   div = document.createElement('div'),  
              vendors = 'Khtml ms O Moz Webkit'.split(' '),  
                  len = vendors.length;  

            return function(prop) {  
              if ( prop in div.style ) return true;  

              prop = prop.replace(/^[a-z]/, function(val) {  
                 return val.toUpperCase();  
              });  

              while(len--) {  
                 if ( vendors[len] + prop in div.style ) {  
                    // browser supports box-shadow. Do what you need.  
                    // Or use a bang (!) to test if the browser doesn't.  
                    return true;  
                 }   
              }  
              return false;  
            };  
        })(); 

        if ( !supports('transform') ) { //IF IT DOES NOT SUPPORT SCALE PROPERTY FOR IE8 for example
             $container.addClass('noSupportTransform');
        }else{
              $container.addClass('visible');
        }

        var rsJSON = null;
        var $directory = $container.data('directory');
        var $path      = $container.data('path');
        var $site      = $container.data('site');
        var $categoryNavBar = $('<ul class="category-navbar" />').hide().insertBefore($container);
        /* *************************************** BRING IMAGES TO THE PARTY *************************************** */
        
        var getCurrentCategory = function(){
              var filter = $categoryNavBar.find('li[class=select]').data('category');
              return filter;
        }

        var loadMore = $('<div />').insertAfter($container);

        var addLoading = function(){
            loadMore.addClass('grid-loader').removeClass('grid-loadMore').html('');
        };

        var clearLoading = function(){
            loadMore.removeClass('grid-loader');
        };

        var loadingScroll = false;
        var anyMoreImages = function(category){

            var cont = 0;

            for (var key in rsJSON) {
               var cat = rsJSON[key];
               if(category == key || category == 'all'){
                  for (var img in cat) {
                      cont++;
                  }
               }
            }

            if(cont>0){
                loadingScroll = false;
                return true;
            }else{
                return false;
            }

        };

        var fixLoadMoreButton = function(result){

              if(result){
                  loadMore.addClass('grid-loadMore').html('LOAD MORE IMAGES');
              }else{
                  loadMore.removeClass('grid-loadMore').html('');
              }

        };

        var makeBox = function(category, imgName, thumb){
            
            var thumbFolder = 'thumbnails/';
            if(thumb == 'no'){
                thumbFolder = '';
            }

            var categoryURL = category+'/';
            if(category == 'all'){
              categoryURL = '';
            }

            var imgTitle = imgName.split(/\.(?=[^.]*$)/)[0];

            var categoryHTML = '<h5>In '+category+'</h5>';

            if(category == 'all' || ops.captionCategory == false){
                categoryHTML = '';
            }

            var url = '';
            if(imgTitle.indexOf("$$") != -1){
                var arr = imgTitle.split("$$");
                imgTitle = arr[0];

                var link = arr[1].split(':').join('/');
                link = link.split('|').join('/');
                url = 'data-url="'+link+'"';
            }

            if( imgTitle.substr(1,1) == '-' ){
                imgTitle = imgTitle.substr(2);
            }

            var box ='<div class="agrg_box" data-category="'+category+'" '+url+'>'+
                          '<img src="'+$path+$directory+'/'+categoryURL+thumbFolder+imgName+'" data-lightbox="'+$path+$directory+'/'+categoryURL+imgName+'" />'+
                                '<div class="image-caption">'+
                                      '<h3>'+imgTitle+'</h3>'+
                                      categoryHTML+
                                '</div>'+
                          '<div class="lightbox-text">'+
                                imgTitle+' <span>In '+category+'</span>'+
                          '</div>'+
                      '</div>';

            

            return box;
        };

        var verifyNavBar = function(){
            var category = getCurrentCategory();

            if(category != 'all'){
                $container.children('div').not('.agrg_box[data-category="'+category+'"]')
                            .removeClass("agrg_box autoGridGallery-brick")
                            .hide();
            }
            
        }


        var waitUntilLoad = function(boxes){
            boxes = $(boxes).addClass('loading-box');
            //APPLY THE MARGIN BOTTOM THAT WAS SET
            boxes.css('margin-bottom', ops.verticalSpaceBetweenThumbnails);

            //ADD IT TO THE PARTY AND HIDE IT UNTIL IT LOAD
            $container.append( boxes.hide() );
            
            $container.imagesLoaded(function(){
                boxes.hide();

                verifyNavBar();

                $container.addClass('autoGridGallery-with-loading-boxes');
                $container.autoGridGallery('reload');

                var boxesShow = [];
                boxesShow.push(boxes);
                specialAnimation(boxesShow, []);

                clearLoading();
                fixLoadMoreButton( anyMoreImages(getCurrentCategory()) );
                loadingScroll = false;
            });
        };


        //CUSTOMIZATION --> 
        /**
         * Return an Object sorted by it's Key
         */
        var sortObjectByKey = function(obj){
            var keys = [];
            var sorted_arr = Array();

            for(var key in obj){
                if(obj.hasOwnProperty(key)){
                    keys.push(obj[key].order.toLowerCase()+"-&$&$-"+key);
                }
            }
            
            // sort keys
            keys.sort();
            if( ops.imagesOrder == "byName" || ops.imagesOrder == "byDateReverse" ){
                //do nothing
            } else {
                //Reverse order
                keys.reverse();
            }
            
            // create new array based on Sorted Keys
            jQuery.each(keys, function(i, key){
                var index = key.split('-&$&$-');
                index = index[1];
                sorted_arr.push( obj[index] );
            });

            return sorted_arr;
        };


        var loadImages = function(numberImagesToLoad){
            addLoading();

            //GET THE CATEGORY WITH THE MAXIUM NUMBER OF IMAGES
            var max = 0; 
            for(var key in rsJSON){
                var category = rsJSON[key];
                var length = 0;
                for (var img in category) { length++; } 

                if(length>max)max=length;
            }


            //GET THE IMAGES FROM ALL FOLDERS
            var collection = new Array();
            if(ops.aleatoryImagesFromCategories){
                for(var i=0; i<max; i++){

                    var cont = 0;
                    for(var key in rsJSON){
                      category = rsJSON[key];
                      var keyTmp = key;
                      if(cont == 0){
                          keyTmp = 'all';  
                      }
                      var cont2 = 0;
                      for (var img in category) {
                          
                          if(cont2 == i){
                            collection.push({ 'category':keyTmp, 'image':img, 'thumb': category[img].thumb, 'order': category[img].order, 'categoryOriginal': key  });
                            break;
                          }
                          cont2++;
                      }
                      cont++;
                    }

                }
            }else{
                var cont = 0;
                for (var key in rsJSON) {
                   var category = rsJSON[key];
                   var keyTmp = key;
                   if(cont == 0){
                      keyTmp = 'all';  
                   }
                   for (var img in category) {
                      collection.push({ 'category':keyTmp, 'image':img, 'thumb': category[img].thumb, 'order': category[img].order, 'categoryOriginal': key });
                   }

                   cont++;
                }
            }

            //CUSTOMIZATION
            if( ops.orderInAll && ops.imagesOrder != 'random' ){
                collection = sortObjectByKey(collection);
            }

            var boxes = "";
            var num = 0;
            while(num<numberImagesToLoad){
                if(num>=collection.length)break;

                var obj = collection[num];
                boxes += makeBox(obj['category'], obj['image'], obj['thumb']);

                //DELTE THE IMAGES THAT ARE ALREADY IN THE GRID BECAUSE WE DON'T NEED THEM ANYMORE
                delete rsJSON[ obj['categoryOriginal'] ] [obj['image']];

                num++;
            }

            waitUntilLoad(boxes);
        }

        var loadImagesByCategory = function(numberImagesToLoad, currentCategory){
            addLoading();

            //GET THE IMAGES FROM ALL FOLDERS
            var collection = new Array();
            
            var cont = 0;
            for (var key in rsJSON) {
               var category = rsJSON[key];
               var keyTmp = key;
               if(cont == 0){
                  keyTmp = 'all';  
               }

               if(keyTmp == currentCategory){
                 for (var img in category) {
                    collection.push({ 'category':keyTmp, 'image':img, 'thumb': category[img].thumb, 'order': category[img].order, 'categoryOriginal': key });
                 }
               }

               cont++;
            }

            //CUSTOMIZATION
            if( ops.orderInAll && ops.imagesOrder != 'random' ){
                collection = sortObjectByKey(collection);
            }

            var boxes = "";
            var num = 0;
            while(num<numberImagesToLoad){
                if(num>=collection.length)break;

                var obj = collection[num];
                boxes += makeBox(obj['category'], obj['image'], obj['thumb']);

                //DELTE THE IMAGES THAT ARE ALREADY IN THE GRID BECAUSE WE DON'T NEED THEM ANYMORE
                delete rsJSON[ obj['categoryOriginal'] ] [obj['image']];

                num++;
            }

            waitUntilLoad(boxes);
        }

        var loadTrigger = function(){
            if(loadMore.hasClass('grid-loadMore')){
                var cat = getCurrentCategory();
                if(cat == 'all'){
                    loadImages(ops.imagesToLoad);
                }else{
                    loadImagesByCategory(ops.imagesToLoad, cat);
                }
            }
        }

        loadMore.on('click', function(){
            loadTrigger();
        });

        /*if(ops.lazyLoad){
          $(window).scroll(function(){
            if(loadMore.closest('html').length){
              if( ($(window).scrollTop() == ($(document).height() - $(window)[0].innerHeight)) && loadingScroll==false ){        
                loadingScroll = true; 
                loadTrigger();
              }
            }
          });
        }*/

        if(ops.lazyLoad){
            
            $container.waypoint(function(direction) {
              var $this = $(this);
              if( $this.hasClass('completeAddingImages') ){                  
                  if(loadMore.hasClass('grid-loadMore')){
                      loadTrigger();
                      $this.removeClass('completeAddingImages');
                  }
              }
            }, {
              context: window,
              continuous: true,
              enabled: true,
              horizontal: false,
              offset: 'bottom-in-view',
              triggerOnce: false,   
            });

        }

        /* *************************************** NAVIGATION BAR FILTER *************************************** */

        var makeNavBar = function(){
            var cont = 0;
            for (var key in rsJSON) {
               var $li = $('<li />').data('category',key).appendTo($categoryNavBar);
               $('<a />').html(key).appendTo($li);

               if(cont == 0){
                  $li.addClass('select');
                  $li.data('category','all');
               }

               cont++;
            }

            if(ops.smartNavBar && cont<=2){
                ops.showNavBar = false;
            }

            if(ops.showNavBar){
                $categoryNavBar.slideDown(400);
            }
        };

        var specialAnimation = function(boxesShow, boxesHide){
            //BOXES TO SHOW HERE ---->
            for(var i=0; i<boxesShow.length; i++){
                boxesShow[i].each(function(){
                    var el = $(this).removeClass('noTransform');

                    if(el.hasClass('autoGridGallery-brick')){//MAKE SURE THE BOX IS GOING TO BE SHOWN
                          if( el.is(':hidden') ){
                              if ( $container.hasClass('noSupportTransform') ) { //IF IT DOES NOT SUPPORT SCALE PROPERTY FOR IE8 for example
                                  el.show();
                              }else{
                                  el.show();
                                  
                                  if(el.data('moving') == false){
                                      el.animate(ops.hiddenStyle,0);  
                                      el.animate(ops.visibleStyle, options.animOpts, function(){ el.addClass('noTransform'); });
                                  }else{
                                      el.animate(ops.visibleStyle, 0); //If is hidden and it is going to move make sure it is visible
                                      el.addClass('noTransform');
                                  }
                              }
                          }else{
                            el.animate(ops.visibleStyle,options.animOpts, function(){ el.addClass('noTransform'); });
                          }
                    } 

                });
            }

            //BOXES TO HIDE HERE --->
            for(var i=0; i<boxesHide.length; i++){
                boxesHide[i].each(function(){
                    var el = $(this).removeClass('noTransform');
                    if( el.is(':hidden') == false ){
                        
                        el.addClass('box');
                        if ( $container.hasClass('noSupportTransform') ) { //IF IT DOES NOT SUPPORT SCALE PROPERTY FOR IE8 for example
                             el.hide();
                             el.removeClass('box'); 
                        }else{
                            el.animate(ops.visibleStyle,0);  
                            el.animate(ops.hiddenStyle, options.animOpts, function(){
                                el.hide();
                                el.removeClass('box');
                            });
                        }
                        
                    }else{
                      //do nothing
                    }
                });
            }

        }


        /* ************ BRING INFORMATION THROUGH JSON ********* */
        $.getJSON($path+"reader.php?directory="+$directory+'&categoriesOrder='+ops.categoriesOrder+'&imagesOrder='+ops.imagesOrder,function(data){ 
            rsJSON = data;

            if( jQuery.isArray( data['All'] ) ){
                data['All'] = {};
            }
            
            $categoryNavBar.css('display','none');

            makeNavBar();

            loadImages(ops.imagesToLoadStart);
        });


        $categoryNavBar.on('click', 'a', function(evt){
            evt.preventDefault();

            var $this = jQuery(this);

            if($this.parent('li').hasClass('select')){
                return;
            }

            //so the lazy load doesnt trigger until the filtering is finish
            $container.removeClass('completeAddingImages');
            $container.addClass('autoGridGallery-with-loading-boxes');

            $this.parent('li').addClass('select').siblings('li').removeClass('select');

            var elem =  $container;
            var filter = $this.parent('li').data('category');

            var boxesShow = [];
            var boxesHide = [];

            if(filter == 'all'){
                var all = elem.children('div').addClass('agrg_box autoGridGallery-brick');
                if ( $container.hasClass('noSupportTransform') ) { 
                    all.css({'top': 200, 'left': 200});
                } 
                boxesShow.push( all );
            }else{
                var category = elem.children('div[data-category="'+filter+'"]').addClass('agrg_box autoGridGallery-brick');
                if(category[0] != undefined){
                    if ( $container.hasClass('noSupportTransform') ) { 
                        category.css({'top': 200, 'left': 200});
                    }
                    boxesShow.push( category.stop() );
                }


                var hide     = elem.children('div').not('.agrg_box[data-category="'+filter+'"]').removeClass("agrg_box autoGridGallery-brick");

                boxesHide.push( hide );                    
            }

            $container.autoGridGallery('reload');

            //-------  SPECIAL ANIMATION ------->

            specialAnimation(boxesShow, boxesHide);

            //-------  END SPECIAL ANIMATION ------->

            fixLoadMoreButton( anyMoreImages(getCurrentCategory()) );

        });



        /* *************************************** CAPTIONS *************************************** */

        $container.on( 'mouseenter.hoverdir, mouseleave.hoverdir', 'div.agrg_box', function( event ) {
            if(!ops.caption)return;
                
            var $el         = $(this),
                evType      = event.type,
                $hoverElem  = $el.find( 'div.image-caption' ),
                direction   = _getDir( $el, { x : event.pageX, y : event.pageY } ),
                cssPos    =   _getPosition( direction, $el );
            
            
            //ALIGNMENT
            var child = $hoverElem.children('div.aligment');
            if(child[0] == undefined){
                var tmpHTML = $hoverElem.html();
                $hoverElem.html("<div class='aligment'><div class='aligment'>"+tmpHTML+"</div></div>");
            }

            if( evType === 'mouseenter' ) {
                if(ops.captionType == 'classic'){
                    $hoverElem.css( { "left" : 0, "top" : 0 } );
                    $hoverElem.fadeIn(300);
                    return;
                }

                $hoverElem.css( { "left" : cssPos.from, "top" : cssPos.to } );
              
                $hoverElem.stop().show().fadeTo(0, 1, function() {
                                                    $(this).stop().animate( { "top" : 0, "left" : 0 } , 200, "linear" );
                                                } );
                
            }
            else {

                if(ops.captionType == 'classic'){
                    $hoverElem.css( { "left" : 0, "top" : 0 } );
                    $hoverElem.fadeOut(300);
                    return;
                }
              
                if(ops.captionType == 'grd-fade'){
                      $hoverElem.fadeOut(700);
                }else{
                      $hoverElem.stop().animate( { "left" : cssPos.from, "top" : cssPos.to }, 200, "linear", function(){$hoverElem.hide();} );
                }

            }
                
        } );

        var _getDir = function( $el, coordinates ) {
            /** the width and height of the current div **/
            var w = $el.width(),
                h = $el.height(),

                /** calculate the x and y to get an angle to the center of the div from that x and y. **/
                /** gets the x value relative to the center of the DIV and "normalize" it **/
                x = ( coordinates.x - $el.offset().left - ( w/2 )) * ( w > h ? ( h/w ) : 1 ),
                y = ( coordinates.y - $el.offset().top  - ( h/2 )) * ( h > w ? ( w/h ) : 1 ),
            
                /** the angle and the direction from where the mouse came in/went out clockwise (TRBL=0123);**/
                /** first calculate the angle of the point, 
                add 180 deg to get rid of the negative values
                divide by 90 to get the quadrant
                add 3 and do a modulo by 4  to shift the quadrants to a proper clockwise TRBL (top/right/bottom/left) **/
                direction = Math.round( ( ( ( Math.atan2(y, x) * (180 / Math.PI) ) + 180 ) / 90 ) + 3 )  % 4;
            
            return direction;
            
        };

        var _getPosition = function( direction, $el ) {
            var fromLeft, fromTop;
            switch( direction ) {
                case 0:
                    // from top
                    if ( !ops.reverse ) { 
                            fromLeft = 0, fromTop = - $el.height() 
                    }else {  
                            fromLeft = 0, fromTop = - $el.height()  
                    }
                    break;
                case 1:
                    // from right
                    if ( !ops.reverse ) { 
                            fromLeft = $el.width()  , fromTop = 0
                    }else {  
                            fromLeft = - $el.width() , fromTop = 0 
                    }
                    break;
                case 2:
                    // from bottom
                    if ( !ops.reverse ) { 
                            fromLeft = 0 , fromTop = $el.height() 
                    }
                    else {  
                            fromLeft = 0, fromTop = - $el.height()  
                    }
                    break;
                case 3:
                    // from left
                    if ( !ops.reverse ) {
                            fromLeft = -$el.width()  , fromTop = 0
                    }
                    else {  
                            fromLeft =  $el.width(), fromTop = 0 
                    }
                    break;
            };
            return { from : fromLeft, to: fromTop };
        }; 

        /* *************************************** LIGHTBOX *************************************** */
        var $body           = $('body');

        var vars = {
            interval: 'none'
        };

        var currentIndex    = 0;
        //Container with the black Background
        var $lightbox       = $('<div class="autoGrid-lightbox" />').appendTo($body); 
        //Navigation Bar
        var $lbnav          = $('<div class="autoGrid-nav" />').appendTo($lightbox);

        var $navClose       = $('<div class="autoGrid-close" />').appendTo($lbnav);
        var $iconClose      = $('<i class="iconClose" />').appendTo($navClose);


        var $navPlay       = $('<div class="autoGrid-play" />');
        if(ops.lightboxPlayBtn){
            $navPlay.appendTo($lbnav);
        }
        var $iconPlay      = $('<i class="iconPlay" />').appendTo($navPlay);


        var $navCaption     = $('<div class="autoGrid-lbcaption" />').appendTo($lbnav).html("Here will go the text for the lightbox");

        var $navNext        = $('<div class="autoGrid-next" />').appendTo($lbnav);
        var $iconNext       = $('<i class="iconNext" />').appendTo($navNext);

        var $navPrev        = $('<div class="autoGrid-prev" />').appendTo($lbnav);
        var $iconPrev       = $('<i class="iconPrev" />').appendTo($navPrev);

        var $lightboxTimer  = $('<div class="lightbox-timer" />').appendTo($lightbox);

        var $closeWidth       = $navClose.width();

        var numOptions = 3;
        if(ops.lightboxPlayBtn)numOptions = 4;

        var fixImage = function(){
                var navWidth    = $lightbox.outerWidth();
                if(navWidth<650){//For responsive purpose
                    $navCaption.hide();
                    $navNext.css('width', (navWidth/numOptions));
                    $navPrev.css('width', (navWidth/numOptions));
                    $navPlay.css('width', (navWidth/numOptions));
                    $navClose.css('width', navWidth-((navWidth/numOptions)*(numOptions-1)) );
                }else{
                    $navCaption.show();
                    $navNext.css('width', $closeWidth );
                    $navPrev.css('width', $closeWidth );
                    $navPlay.css('width', $closeWidth );
                    $navClose.css('width', $closeWidth );
                }

                var img         = $lightbox.find('img');
                var maxHeight   = $lightbox.outerHeight()-$lbnav.outerHeight();
                img.css('max-height', maxHeight);
        };

        jQuery(window).resize(function(){
            fixImage();
        });

        var currentImage = new Image();

        var clearCurrengImage = function(){
            if(currentImage != null){
                currentImage.onload = null;
                currentImage        = null;
            }

            $lightbox.find('.lightbox-alignment').remove();
            $lightbox.find('.lightbox-alignment2').remove();

            $lightbox.find('img').remove();
        }

        var clearLoader = function(){
            $lightbox.find('.lb-loader').remove();
        }

        var addLoader = function(){
            $lightbox.append('<div class="lb-loader"/>');
        }

        //DISABLE TEXT SELECTION
        $lightbox.attr('unselectable', 'on').css('user-select', 'none').on('selectstart', false);

        //stop timer
        var stopTimer = function(){
            $lightboxTimer.stop( true, true ).width( 0 );
        };

        var stopInterval = function(){
            clearInterval(vars.interval);
        };

        //update timer
        var updateTimer = function(){
            if(ops.lightBoxShowTimer == false)return;
            $lightboxTimer.css({'position': 'absolute', 'bottom':0}).animate( { width: '100%' }, ops.lightBoxPlayInterval, 'linear', function(){ stopTimer(); } );
        };

        

        var playing = false;
        var closing = false;

        //Play slideshow
        var play = function(){
            vars.interval = setTimeout(function(){
                next();   
            }, ops.lightBoxPlayInterval);

            updateTimer();
        }
        
        //WHEN THE LIGHTBOX FINISH TO LOAD AN IMAGE
        var finish = function(){
            if(playing && closing==false){
                stopTimer();
                stopInterval();
                play();
            }
        }

        var $currentImage = $('<span />');
        var loadImage = function(image, firstTime){
                //Clear image and loader
                clearCurrengImage();
                clearLoader();

                //Add a loader
                addLoader();

                var scale = 0;
                var fade  = 0;
                if(firstTime != true){
                  scale = .9;
                  fade  = ops.lightBoxSpeedFx;
                }
                if(ops.lightBoxZoomAnim == false){
                  scale = 1;
                }
                
                //GET THE SRC OF THE IMAGE THAT WILL BE SHOWN IN THE LIGHTBOX
                var thumbnail = image;
                var src = thumbnail.data('lightbox');

                if(src == undefined){
                    src = thumbnail.attr('src');
                }

                /*if(src.indexOf('thumbnails') != -1){
                    var arr = src.split('thumbnails/');

                    src = arr[0]+arr[1];
                }*/

                //ADD TEXT TO THE LIGHTBOX
                var text    = thumbnail.siblings('div.lightbox-text').html();
                if(ops.lightBoxText == false){
                    text = "";
                }

                //var FBlike = "<iframe src=\"//www.facebook.com/plugins/like.php?href="+$site+src+"&amp;send=false&amp;layout=button_count&amp;width=450&amp;show_faces=false&amp;font&amp;colorscheme=light&amp;action=like&amp;height=21&amp;appId=250961795046291\" scrolling=\"no\" frameborder=\"0\" style=\"border:none;pa overflow:hidden; position:absolute;margin-top:-3px;width:200px; height:21px;\" allowTransparency=\"true\"></iframe>";
                //var FBshare = "<a href='https://www.facebook.com/sharer/sharer.php?u="+$site+src+"' target='_blank'>Share on Facebook</a>";

                var name = text.split('<span>')[0];

                var social = "<div class='ag-social-container'>";
                if(ops.fb != undefined){//FB
                  social+="<div class='ag-fb' data-url='"+$site+src+"' data-name='"+name+"' ></div>";
                }
                if(ops.twitter != undefined){//Twitter
                  social+="<div class='ag-tw' data-url='"+$site+src+"' data-name='"+name+"' ></div>";
                }
                if(ops.googlePlus != undefined){//Google+
                  social+="<div class='ag-gp' data-url='"+$site+src+"' data-name='"+name+"' ></div>";
                }
                if(ops.pintrest != undefined){//Pintrest
                  social+="<div class='ag-pi'data-url='"+$site+src+"' data-name='"+name+"' ></div>";
                }

                social+="</div>";



                var txt = "<div><div>"+text+" &nbsp;&nbsp;"+social+"</div></div>";
                $navCaption.html(txt);

                //LOAD THE NEW IMAGE
                currentImage = new Image();
                var $img = $(currentImage);
                var tmp = currentImage;

                currentImage.onload = function() {
                    if(tmp!=currentImage)return;
                    
                    clearLoader();
                    
                    var div1 = $('<div class="lightbox-alignment"></div>').appendTo($lightbox);
                    var div2 = $('<div class="lightbox-alignment2"></div>').appendTo(div1);
                    div2.append($img.css('margin-top', -$lbnav.outerHeight()).hide().scale(scale));

                    $img.fadeIn(fade).animate({
                        scale: '1'
                    },  {duration : ops.lightBoxSpeedFx , complete: function(){ finish(); } });

                    fixImage();
                    
                };

                /*currentImage.onerror=function(){
                    clearLoader();
                    alert("Error Loading the Image in this url: "+currentImage.src);
                }*/

                currentImage.src = src;
                $currentImage.stop(true);
                $currentImage = $(currentImage);

        };

        var openWindow = function(url){
            var w = window.open(url, "ftgw", "location=1,status=1,scrollbars=1,width=600,height=400");
            w.moveTo((screen.width / 2) - (300), (screen.height / 2) - (200));
        }
        //FACEBOOK SHARE
        $lbnav.on('click', 'div.ag-fb', function(){
            var $this = $(this);
            var url = "http://www.facebook.com/sharer.php?u=" + encodeURI($this.data('url')) + "&t=" + encodeURI($this.data('name'));
            openWindow(url);
        });
        //TWITTER SHARE
        $lbnav.on('click', 'div.ag-tw', function(){
            var $this = $(this);
            var url = "https://twitter.com/intent/tweet?url=&text=" + encodeURI($this.data('name'))+" "+encodeURI($this.data('url'));
            openWindow(url);
        });
        //GOOGLE PLUS
        $lbnav.on('click', 'div.ag-gp', function(){
            var $this = $(this);
            var url = "https://plus.google.com/share?url=" + encodeURI($this.data('url'));
            openWindow(url);
        });
        //PINTREST
        $lbnav.on('click', 'div.ag-pi', function(){
            var $this = $(this);
            var url = "http://pinterest.com/pin/create/button/?url=" + encodeURI($this.data('url')) + "&description=" + encodeURI($this.data('name'));
            openWindow(url);
        });


        var lightboxOpen = false;
        var urlToLinkForLightbox  = '';

        //Open Light Box
        $container.on('click', 'div.agrg_box', function(){
            lightboxOpen = true;
            var $this = $(this);

            var url = $this.data('url');

            urlToLinkForLightbox = '';
            if(url != undefined && ops.linkOnLightbox == true){
                urlToLinkForLightbox = "http://"+url;
            }else if(url != undefined){
                window.open("http://"+url , '_blank');
                return;
            }

            if(ops.lightBox == false){
              return;
            }

            closing = false;

            //$body.css('overflow', 'hidden');

            //set current index
            currentIndex = $container.find('.agrg_box').index(this);

            var img = $this.children('img');

            //ANIMATE THE NAVIGATION BAR OF THE LIGHTBOX
            $lbnav.animate({
                                'margin-top': 0
                            }, ops.lightBoxSpeedFx);
            
            //SHOW THE LIGHTBOX
            $lightbox.fadeIn(ops.lightBoxSpeedFx);

            loadImage(img, true);

        });

        //Stop propagation
        $lightbox.on('click', 'div', function(e){
            e.stopPropagation();
        });
        $lightbox.on('click', 'img', function(e){
            e.stopPropagation();
        });

        //Close Light Box
        $lightbox.on('click', '.lightbox-alignment', function(){
            close();
        });

        //Close Light Box
        $lightbox.on('click', '.lightbox-alignment2', function(){
            close();
        });

        //Close Light Box
        $lightbox.on('click', function(){
            close();
        });

        $navClose.on('click', function(){
            close();
        });

        var close = function(){
            if(ops.lightBoxStopPlayOnClose){
                $navPlay.removeClass('selected');
                playing = false;
            }

            lightboxOpen = false;
            closing = true;
            stopTimer();
            stopInterval();

            $lightbox.find('.lb-loader').remove();
            var scale = 0;
            if(ops.lightBoxZoomAnim == false){
              scale = 1;
            }

            var currentImg = $lightbox.find('img').stop().show();
            $lbnav.animate({
                                'margin-top': -$lbnav.outerHeight()
                            }, ops.lightBoxSpeedFx);

            if(currentImg[0] != undefined){
                currentImg.animate({
                          scale: scale
                      }, ops.lightBoxSpeedFx, function(){
                          $lightbox.fadeOut(100);
                          //$body.css('overflow', 'auto');
                      } );
              }else{
                  $lightbox.fadeOut(100);
                  //$body.css('overflow', 'auto');
              }

            
        };

        //Next Post
        var next = function(){
            closing = false;
            var boxes = $container.find('.agrg_box');

            currentIndex+=1;

            if(currentIndex >= boxes.length){
              currentIndex = 0;
            }

            if(!boxes.eq(currentIndex).is(":visible")){//If next is not visible then find the some one that is.
                var cont = currentIndex;
                for(var i=0; i<boxes.length; i++){
                    cont++;
                    if(cont>=boxes.length){
                      cont = 0;
                    }

                    if(boxes.eq(cont).is(":visible")){
                     currentIndex = cont;  
                      break;
                    }
                }
            }

            var img = boxes.eq(currentIndex).children('img');

            //This is just when you want to link the lighbox to an url and refresh that url when you change the image on the Lighbox
            var url = boxes.eq(currentIndex).data('url');
            urlToLinkForLightbox = '';
            if(url != undefined && ops.linkOnLightbox == true){
                urlToLinkForLightbox = "http://"+url;
            }
            
            loadImage(img);
        };

        //Prev Post
        var prev = function(){
            closing = false;
            var boxes = $container.find('.agrg_box');

            currentIndex-=1;


            if(currentIndex < 0){
              currentIndex = boxes.length-1;
            }

            if(!boxes.eq(currentIndex).is(":visible")){//If prev is not visible then find the some one that is.
                var cont = currentIndex;
                for(var i=0; i<boxes.length; i++){
                    cont--;
                    if(cont<0){
                      cont = boxes.length-1;
                    }

                    if(boxes.eq(cont).is(":visible")){
                     currentIndex = cont;  
                      break;
                    }
                }
            }

            var img = boxes.eq(currentIndex).children('img');

            //This is just when you want to link the lighbox to an url and refresh that url when you change the image on the Lighbox
            var url = boxes.eq(currentIndex).data('url');
            urlToLinkForLightbox = '';
            if(url != undefined && ops.linkOnLightbox == true){
                urlToLinkForLightbox = "http://"+url;
            }

            loadImage(img);
        };


        //TRIGGER EVENTS
        $navNext.on('click', function(){  
            stopTimer();
            stopInterval();    
            next();
        });

        $lightbox.on('click', 'img', function(){
            if( urlToLinkForLightbox == '' ){
                stopTimer();
                stopInterval();
                next();  
            }else{
                //location.href = urlToLinkForLightbox;
                window.open(urlToLinkForLightbox , '_blank');
            }
        });

        $navPrev.on('click', function(){
            stopTimer();
            stopInterval();
            prev();
        });

        if(ops.someSecurity){
          //Some security
          $lightbox.on('contextmenu', 'img', function(e) {
              return false;
          });
          $lightbox.on('dragstart', 'img', function(e) { 
              e.preventDefault(); 
          });
        }
        //-->

        //Keyboard Navigation
        $(document).keyup(function(event){
            if(!ops.lightboxKeyboardNav)return;
            //prev keyCode
            if(event.keyCode == '37'){
                if(lightboxOpen == false)return;

                stopTimer();
                stopInterval();
                prev();
            }
            //next keyCode
            if(event.keyCode == '39'){
                if(lightboxOpen == false)return;

                stopTimer();
                stopInterval();
                next();
            }
            //esc keyCode
            if (event.keyCode == 27) { 
                close();
            }
        });

        if(ops.lightBoxAutoPlay){
            $navPlay.addClass('selected');
            playing = true;
        }

        //AUTO PLAY
        $navPlay.on('click', function(){

            $this = $(this);

            if($this.hasClass('selected')){
                $this.removeClass('selected');
                playing = false;
                stopTimer();
                stopInterval();
            }else{
                $this.addClass('selected');
                playing = true;
                play();
            }

            

        });

        //END LIGHTBOX //*********************************************************************//
    };
    //=End db





    if ( typeof options === 'string' ) {
      // call method
      var args = Array.prototype.slice.call( arguments, 1 );

      this.each(function(){
        var instance = $.data( this, 'autoGridGallery' );
        if ( !instance ) {
          logError( "cannot call methods on autoGridGallery prior to initialization; " +
            "attempted to call method '" + options + "'" );
          return;
        }
        if ( !$.isFunction( instance[options] ) || options.charAt(0) === "_" ) {
          logError( "no such method '" + options + "' for autoGridGallery instance" );
          return;
        }
        // apply method
        instance[ options ].apply( instance, args );
      });
    } else {

      this.each(function() {
        var instance = $.data( this, 'autoGridGallery' );

        if ( instance ) {
          // apply options & init
          instance.option( options || {} );
          instance._init();
        } else {
          
          //=db
          db(this);
          //=End db

          // initialize new instance
          $.data( this, 'autoGridGallery', new $.AutoGridMasonry( options, this ) );
        }
      });
    }
    return this;
  };


  //Default settings
  $.fn.autoGridGallery.defaults = {
      categoriesOrder: 'byDate', //byDate, byDateReverse, byName, byNameReverse, random
      imagesOrder: 'byDate', //byDate, byDateReverse, byName, byNameReverse, random
      orderInAll: true, // When the 'All' tab is selected the images will be ordered as well and the 'aleatoryImagesFromCategories' option will not work
      isFitWidth: true, //Nedded to be true if you wish to center the gallery to its container
      lazyLoad: false, //If you wish to load more images when it reach the bottom of the page
      showNavBar: true, //Show the navigation bar?
      smartNavBar: true, //Hide the navigation bar when you don't have categories or just 1
      imagesToLoadStart: 15, //The number of images to load when it first loads the grid
      imagesToLoad: 5, //The number of images to load when you click the load more button
      aleatoryImagesFromCategories: true,//Get few images from each category if not it will get them in order
      horizontalSpaceBetweenThumbnails: 5, //The space between images horizontally
      verticalSpaceBetweenThumbnails: 5, //The space between images vertically
      columnWidth: 'auto', //The width of each columns, if you set it to 'auto' it will use the columns instead
      columns: 5, //The number of columns when you set columnWidth to 'auto'
      columnMinWidth: 220, //The minimum width of each columns when you set columnWidth to 'auto'
      isAnimated: true, //Animation when resizing or filtering with the nav bar
      caption: true, //Show the caption in mouse over
      captionCategory: true,//Show the category section of the caption
      captionType: 'grid-fade', // 'grid', 'grid-fade', 'classic' the type of caption effect
      lightBox: true, //Do you want the lightbox?
      lightboxKeyboardNav: true, //Keyboard navigation of the next and prev image
      lightBoxSpeedFx: 500, //The speed of the lightbox effects
      lightBoxZoomAnim: true, //Do you want the zoom effect of the images in the lightbox?
      lightBoxText: true, //If you wish to show the text in the lightbox
      lightboxPlayBtn: true, //Show the play button?
      lightBoxAutoPlay: false, //The first time you open the lightbox it start playing the images
      lightBoxPlayInterval: 4000, //The interval in the auto play mode 
      lightBoxShowTimer: true, //If you wish to show the timer in auto play mode
      lightBoxStopPlayOnClose: false, //Stop the auto play mode when you close the lightbox?
      someSecurity: false,

      linkOnLightbox: true,

      hiddenStyle: { opacity: 0, scale: 0.001 },
      visibleStyle: { opacity: 1, scale: 1 },
  };

})( window, jQuery );
