(function($){
    'use strict';

    $('.slider-parallax').prev('#header').addClass('header-slider-parallax slider-fixed');

    if( $('#header').hasClass('sticky-header') && ! $('body').hasClass('force-sticky-header')){
        $('.header-parallax').css('margin-top', $('#header').height());
    }

    var windowsize = $(window).width();

    if(yit.isRtl)    {
        $("#primary .slider-parallax").css({
            right: -( windowsize / 2 ),
            width: windowsize
        });

        $("#primary .slider-parallax-item").css({
            right: "auto",
            width: windowsize
        });
    }
    else{
        $("#primary .slider-parallax, .header-parallax .parallaxeos_outer").css({
            left: -( windowsize / 2 ),
            width: windowsize
        });

        $("#primary .slider-parallax-item").css({
            left: "auto",
            width: windowsize
        });
    }

    if ($.fn.imagesLoaded && $.fn.owlCarousel ) {
        $('.slider-parallax').imagesLoaded(function(){
            var autoplay = false,
                initAnimation = function() {
                    $('.slider-parallax-item').each(function(){
                        $(this)
                            .addClass('parallaxeos_slider')
                            .find('.parallaxeos_animate').removeClass('animated');
                    });
                },
                slider = $(this);


            if ( typeof slider.data('autoplay') != undefined){
                autoplay = slider.data('autoplay');
            }

            slider.on('grab', function(e){
                e.stopPropagation();
            });

            slider.owlCarousel({
                autoPlay: autoplay,
                singleItem: true,
                navigation : true,
                stopOnHover: false,
                paginationSpeed : 400,
                beforeInit: initAnimation,
                afterAction: function(current) {
                    current.find('.parallaxeos_animate').removeClass('animated');
                    setTimeout(function(){
                        current.find('.parallaxeos_animate').addClass('animated');
                    }, 50);

                    current.find('.video-parallaxeos').trigger('play');


                }
            });
        });
    }

})(jQuery);