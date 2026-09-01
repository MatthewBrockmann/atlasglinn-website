<?php
/**
 * Front page — the full MAST Solutions single-page site.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

get_header();

get_template_part( 'template-parts/hero' );
get_template_part( 'template-parts/classes' );
get_template_part( 'template-parts/memberships' );
get_template_part( 'template-parts/skills' );
get_template_part( 'template-parts/instructor' );
get_template_part( 'template-parts/media' );
get_template_part( 'template-parts/reviews' );
get_template_part( 'template-parts/contact' );

get_footer();
