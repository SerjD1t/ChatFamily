package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"os"
	"strings"
	"time"

	"familychat/internal/config"
	"familychat/internal/store"
)

func (a *app) sendInvitation(ctx context.Context, to, token, family, role, relationship string) error {
	if os.Getenv("MAIL_CONTROL_SOCKET") != "" {
		link := strings.TrimRight(a.cfg.PublicURL, "/") + "/?invite=" + token
		return a.sendMail(ctx, to, "ChatFamily: приглашение в семью", fmt.Sprintf("Вас пригласили в семью. Примите приглашение: %s\nОдноразовый код: %s", link, token))
	}
	return sendInvitationMail(a.cfg, to, token, family, role, relationship)
}

func sendInvitationMail(cfg config.Config, to, token, family, role, relationship string) error {
	if cfg.MailHost == "" || cfg.MailFrom == "" {
		return errors.New("mail disabled")
	}
	if _, err := store.NormalizeEmail(to); err != nil {
		return err
	}
	if _, err := store.NormalizeEmail(cfg.MailFrom); err != nil {
		return err
	}
	addr := net.JoinHostPort(cfg.MailHost, cfg.MailPort)
	link := strings.TrimRight(cfg.PublicURL, "/") + "/?invite=" + token
	subject := "Приглашение в семейный чат"
	body := fmt.Sprintf("Вас пригласили в семью «%s». Роль: %s, статус: %s.\r\n\r\nПримите приглашение: %s\r\nОдноразовый код: %s\r\n", family, role, relationship, link, token)
	msg := []byte("From: " + cfg.MailFrom + "\r\nTo: " + to + "\r\nSubject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	tlsConfig := &tls.Config{ServerName: cfg.MailHost, MinVersion: tls.VersionTLS12}
	var conn net.Conn
	var err error
	if cfg.MailPort == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return errors.New("SMTP connection failed")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	client, err := smtp.NewClient(conn, cfg.MailHost)
	if err != nil {
		return errors.New("SMTP greeting failed")
	}
	defer client.Close()
	if cfg.MailPort != "465" {
		if err = client.StartTLS(tlsConfig); err != nil {
			return errors.New("SMTP TLS required")
		}
	}
	if cfg.MailUsername != "" {
		if err = client.Auth(smtp.PlainAuth("", cfg.MailUsername, cfg.MailPassword, cfg.MailHost)); err != nil {
			return errors.New("SMTP authentication failed")
		}
	}
	if err = client.Mail(cfg.MailFrom); err != nil {
		return errors.New("SMTP sender rejected")
	}
	if err = client.Rcpt(to); err != nil {
		return errors.New("SMTP recipient rejected")
	}
	writer, err := client.Data()
	if err != nil {
		return errors.New("SMTP data rejected")
	}
	if _, err = writer.Write(msg); err != nil {
		return errors.New("SMTP write failed")
	}
	if err = writer.Close(); err != nil {
		return errors.New("SMTP delivery failed")
	}
	_ = client.Quit()
	return nil
}
