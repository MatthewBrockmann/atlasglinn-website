<?php
/**
 * SCREETS © 2014
 *
 * Shortcode functions
 *
 * COPYRIGHT (c) 2014 Screets. All rights reserved.
 * This  is  commercial  software,  only  users  who have purchased a valid
 * license  and  accept  to the terms of the  License Agreement can install
 * and use this program.
 */

/**
 * Chat online shortcode
 *
 * @access public
 * @return string
 */
 
function cx_shortcode_online( $atts, $content = '' ) {
	
	// Check if any OP online
	if( Chat::check_if_any_op_online() )
		return $content;
	
}


/**
 * Chat offline shortcode
 *
 * @access public
 * @return string
 */
 
function cx_shortcode_offline( $atts, $content = '' ) {
	
	// Check if all OPs offline
	if( !Chat::check_if_any_op_online() )
		return $content;
	
}