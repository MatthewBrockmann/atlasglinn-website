jQuery(document).ready(function($){

    // contact
    var error = true;

    function addLoading( e )
    {
        $(e).val( '{wait}'.replace('{wait}', contactForm.wait) ).attr('disabled', true);
    }

    function removeLoading( e )
    {
        $(e).val(value_submit).attr('disabled', false);
    }

	function addError(msg, e)
	{
        $(e).addClass("error");
		$(e).parents('li').find('.msg-error').text(msg);	
    }

    function removeError(e)
    {
        $(e).removeClass("error");
        $(e).parents('li').find('.msg-error').text('');
    }

    $('.contact-form .required').blur(function(){

        var name = $(this).attr('name').match( /(.*)\[(.*)\]/ );
        var msg = $('.contact-form-error-'+name[2]).html();

		if( $(this).val() == '' )
			addError( msg, this );       
		else               
			removeError(this);
	});


    $('.contact-form .email-validate').blur(function(){
        var expr = /^[_a-z0-9+-]+(\.[_a-z0-9+-]+)*@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
        var name = $(this).attr('name').match( /(.*)\[(.*)\]/ );
        //var id_form = $(this).parents('.contact-form').find('input[name="id_form"]').val();

        var msg = $('.contact-form-error-'+name[2]).html();

        if( ( $(this).val() != '' && !expr.test( $(this).val() ) ) || ( $(this).is('.required') && $(this).val() == '' ) )
            addError( msg, this );
        else
            removeError(this);
    });





    $('.contact-form').submit(function(){
        addLoading( '.contact-form input:submit' );
    });



});