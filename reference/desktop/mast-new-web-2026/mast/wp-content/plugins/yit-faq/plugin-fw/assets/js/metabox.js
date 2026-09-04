/**
 * This file belongs to the YIT Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */
(function ($) {

    $('.metaboxes-tab').each(function () {
        $('.tabs-panel', this).hide();

        var active_tab = wpCookies.get('active_metabox_tab');
        if (active_tab == null) {
            active_tab = $('ul.metaboxes-tabs li:first-child a', this).attr('href');
        } else {
            active_tab = '#' + active_tab;
        }

        $(active_tab).show();

        $('.metaboxes-tabs a', this).click(function (e) {
            if ($(this).parent().hasClass('tabs')) {
                e.preventDefault();
                return;
            }

            var t = $(this).attr('href');
            $(this).parent().addClass('tabs').siblings('li').removeClass('tabs');
            $('.tabs-panel').slideUp('fast');
            $(t).delay(350).slideDown('fast');

            return false;
        });
    });

    //upload
    var _custom_media = true,
        _orig_send_attachment = wp.media.editor.send.attachment;

    $(document).on('click', '.metaboxes-tab .upload_button', function(e) {
        var send_attachment_bkp = wp.media.editor.send.attachment;
        var button = $(this);
        var id = button.attr('id').replace('-button', '');
        _custom_media = true;
        wp.media.editor.send.attachment = function(props, attachment){
            if ( _custom_media ) {
                if( $("#"+id).is('input[type=text]') ) {
                    $("#"+id).val(attachment.url);
                } else {
                    $("#"+id + '_custom').val(attachment.url);
                }

            } else {
                return _orig_send_attachment.apply( this, [props, attachment] );
            };
        }

        wp.media.editor.open(button);
        return false;
    });

    $('.metaboxes-tab .add_media').on('click', function(){
        _custom_media = false;
    });

    //colorpicker
    $('.metaboxes-tab .panel-colorpicker').wpColorPicker({
        onInit: function(){ console.log('test');},
        change: function(event, ui){
        },
        clear: function(){
            var input = $(this);
            input.val(input.data('default-color'));
            input.change();
        }
    });

    $('.metaboxes-tab .panel-colorpicker').each( function() {
        var select_label = $(this).data('variations-label');
        $(this).parent().parent().find('a.wp-color-result').attr('title', select_label);
    });

    // select
    var select_value = function() {
        var value = '';

        if( $(this).attr('multiple')){
            $(this).children("option:selected").each(function(i,v){
                if( i != 0)
                    value += ', ';

                value += $(v).text();
            });

            if( value == '' ){
                $(this).children().children("option:selected").each(function(i,v){
                    if( i != 0)
                        value += ', ';

                    value += $(v).text();
                });
            }
        }
        else{
            value = $(this).children("option:selected").text();

            if( value == '' )
                value = $(this).children().children("option:selected").text();
        }


        if ( $(this).parent().find('span').length <= 0 ) {
            $(this).before('<span></span>');
        }

        $(this).parent().children('span').replaceWith('<span>'+value +'</span>');
    };
    $('.metaboxes-tab .select_wrapper select').not('.chosen').each(select_value).change(select_value);

    //Open select multiple
    $('.metaboxes-tab .select_wrapper').click( function(e){
        e.stopPropagation();
        $(this).find('select[multiple]').not('.chosen').toggle();
    });
    //Stops click propagation on select, to prevent select hide
    $('.metaboxes-tab .select_wrapper select[multiple]').not('.chosen').click( function(e){
        e.stopPropagation();
    });
    //Hides select on window click
    $(window).click(function(){
         $('.metaboxes-tab .select_wrapper select[multiple]').not('.chosen').hide();
    })

    //on-off
    $('.metaboxes-tab .onoff_container span').on('click', function(){

        var input = $( this ).prev( 'input' );
        var checked = input.prop( 'checked' );

        if( checked ) {
            input.prop( 'checked', false ).attr( 'value', 'no' ).removeClass('onoffchecked');
        } else {
            input.prop( 'checked', true ).attr( 'value', 'yes' ).addClass('onoffchecked');
        }

        input.change();
    });

    //chosen
    $('.metaboxes-tab .chosen .select_wrapper select').chosen();


    $('.metaboxes-tab .slider_container .ui-slider-horizontal').each(function(){
        var val      = $(this).data('val');
        var minValue = $(this).data('min');
        var maxValue = $(this).data('max');
        var step     = $(this).data('step');
        var labels   = $(this).data('labels');

        $(this).slider({
            value: val,
            min: minValue,
            max: maxValue,
            range: 'min',
            step: step,

            slide: function( event, ui ) {
                $(this).find('input').val( ui.value );
                $(this).siblings('.feedback').find('strong' ).text( ui.value + labels );
            }
        });
    });


    var act_page_option = $('#_active_page_options-container').parent().html();
    $('#_active_page_options-container').parent().remove();
    $(act_page_option).insertAfter('#yit-post-setting .handlediv');
    $(act_page_option).insertAfter('#yit-page-setting .handlediv');


    $('#_active_page_options-container').on('click', function(){
        if( $('#_active_page_options').is(":checked") ){
            $('#yit-page-setting .inside .metaboxes-tab, #yit-post-setting .inside .metaboxes-tab').css('opacity',1);
        }else{
            $('#yit-page-setting .inside .metaboxes-tab, #yit-post-setting .inside .metaboxes-tab').css('opacity',0.5);
        }
    }).click();


    //dependencies handler
    $('.metaboxes-tab [data-field]').each(function(){
        var t = $(this);

        var field = '#' + t.data('field'),
            dep = '#' + t.data('dep'),
            value = t.data('value');


        dependencies_handler( field, dep, value.toString() );

        $(dep).on('change', function(){
            dependencies_handler( field, dep, value.toString() );
        }).change();
    });

    //Handle dependencies.
    function dependencies_handler ( id, deps, values ) {
        var result = true;


        //Single dependency
        if( typeof( deps ) == 'string' ) {
            if( deps.substr( 0, 6 ) == ':radio' )
            {deps = deps + ':checked'; }

            var val = $( deps ).val();

            if( $(deps).attr('type') == 'checkbox'){
                var thisCheck = $(deps);
                if ( thisCheck.is ( ':checked' ) ) {
                    val = 'yes';
                }
                else {
                    val = 'no';
                }
            }

            var values = values.split( ',' );

            for( var i = 0; i < values.length; i++ ) {
                if( val != values[i] )
                { result = false; }
                else
                { result = true; break; }
            }
        }

        if( !result ) {
            $( id + '-container' ).parent().hide();
        } else {
            $( id + '-container' ).parent().show();
        }
    };


})(jQuery);
