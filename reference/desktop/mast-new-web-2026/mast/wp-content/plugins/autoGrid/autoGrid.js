;(function($) {//Protect it from other jQuery instances

    $(window).ready(function(){

        //console.log(agrg_vars);

        var cWidth = agrg_vars.columnWidth;
        if( cWidth == 'auto' ){
            //do nothing
        }else{
            cWidth = parseInt(agrg_vars.columnWidth);
        }

      	$('.autoGridResponsiveGallery').autoGridGallery({
            categoriesOrder: agrg_vars.catOrder, //'byDate', //byDate, byDateReverse, byName, byNameReverse, random
            imagesOrder: agrg_vars.imgOrder, //'byDate', //byDate, byDateReverse, byName, byNameReverse, random
            orderInAll: agrg_vars.orderInAll, // When the 'All' tab is selected the images will be ordered as well and the 'aleatoryImagesFromCategories' option will not work  
            isFitWidth: true, //Nedded to be true if you wish to center the gallery to its container
            lazyLoad: agrg_vars.lazyLoad, //If you wish to load more images when it reach the bottom of the page
            showNavBar: agrg_vars.showNavBar, //Show the navigation bar?
            smartNavBar: agrg_vars.smartNavBar, //Hide the navigation bar when you don't have categories or just 1
            imagesToLoadStart: parseInt(agrg_vars.imagesToLoadStart), //The number of images to load when it first loads the grid
            imagesToLoad: parseInt(agrg_vars.imagesToLoad), //The number of images to load when you click the load more button
            aleatoryImagesFromCategories: agrg_vars.aleatory,//Get few images from each category if not it will get them in order
            horizontalSpaceBetweenThumbnails: parseInt(agrg_vars.horizontalSpace), //The space between images horizontally
            verticalSpaceBetweenThumbnails: parseInt(agrg_vars.verticalSpace), //The space between images vertically
            columnWidth: cWidth, //The width of each columns, if you set it to 'auto' it will use the columns instead
            columns: parseInt(agrg_vars.columns), //The number of columns when you set columnWidth to 'auto'
            columnMinWidth: parseInt(agrg_vars.columnMinWidth), //The minimum width of each column when you set columnWidth to 'auto'
            isAnimated: agrg_vars.isAnimated, //Animation when resizing or filtering with the nav bar
            caption: agrg_vars.caption, //Show the caption in mouse over
            captionCategory: agrg_vars.captionCat,//Show the category section of the caption
            captionType: agrg_vars.captionType, // 'grid', 'grid-fade', 'classic' the type of caption effect
            lightBox: agrg_vars.lightbox, //Do you want the lightbox?
            lightboxKeyboardNav: agrg_vars.lightboxKeyboardNav, //Keyboard navigation of the next and prev image
            lightBoxSpeedFx: parseInt(agrg_vars.lightBoxSpeedFx), //The speed of the lightbox effects
            lightBoxZoomAnim: agrg_vars.lightboxZoom, //Do you want the zoom effect of the images in the lightbox?
            lightBoxText: agrg_vars.lightBoxText, //If you wish to show the text in the lightbox
            lightboxPlayBtn: agrg_vars.lightboxPlayBtn, //Show the play button?
            lightBoxAutoPlay: agrg_vars.lightBoxAutoPlay, //The first time you open the lightbox it start playing the images
            lightBoxPlayInterval: parseInt(agrg_vars.lightBoxPlayInterval), //The interval in the auto play mode 
            lightBoxShowTimer: agrg_vars.lightBoxShowTimer, //If you wish to show the timer in auto play mode
            lightBoxStopPlayOnClose: agrg_vars.lightBoxStopPlayOnClose, //Stop the auto play mode when you close the lightbox?
            someSecurity: false,
            linkOnLightbox: false,
        });
    });

})(jQuery);