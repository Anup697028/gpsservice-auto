import React from 'react';
import '../styles/modal.css';

export const Modal = ({
  isOpen,
  title,
  subtitle,
  children,
  onClose,
  onSubmit,
  submitText = 'Submit',
  cancelText = 'Cancel',
  showFooter = true,
  submitVariant = 'primary',
  disableSubmit = false,
}) => {
  if (!isOpen) return null;

  const submitClass = submitVariant === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" aria-hidden="true">
          <span />
        </div>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close dialog">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
        {showFooter ? (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose} type="button">
              {cancelText}
            </button>
            <button className={submitClass} onClick={onSubmit} disabled={disableSubmit} type="button">
              {submitText}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
